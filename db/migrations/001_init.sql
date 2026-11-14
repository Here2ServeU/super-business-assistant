-- Super Business Assistant: initial schema.
-- Every business table carries tenant_id. All app queries go through src/lib/dal.

create extension if not exists vector;
create extension if not exists btree_gist;
create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists tenant_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','approver','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- The client profile (onboarding template), one row per tenant.
create table if not exists tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  profile jsonb not null,
  paused boolean not null default false,
  shadow_mode boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists mail_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null check (provider in ('gmail','microsoft','demo')),
  account_email text not null default '',
  -- AES-256-GCM ciphertext of the OAuth token bundle. Never stored in plain text.
  token_ciphertext text,
  scopes text not null default '',
  status text not null default 'active',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null,
  provider_message_id text not null,
  thread_id text,
  from_addr text not null,
  from_name text not null default '',
  to_addr text not null default '',
  subject text not null default '',
  -- Guarded (masked) body only. The raw body is never stored.
  body text not null,
  received_at timestamptz not null default now(),
  masked_flags text[] not null default '{}',
  injection_suspected boolean not null default false,
  category text,
  urgent boolean not null default false,
  language text not null default 'en',
  status text not null default 'new'
    check (status in ('new','sorted','drafted','escalated','no_reply','waiting_budget','done')),
  escalation_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, provider_message_id)
);
create index if not exists messages_tenant_received on messages (tenant_id, received_at desc);

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','approved','edited','rejected','escalated','sent')),
  to_addr text not null,
  subject text not null,
  body text not null,
  final_body text,
  model text not null,
  sources jsonb not null default '[]',
  proposed_slots jsonb not null default '[]',
  escalate boolean not null default false,
  escalation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, message_id)
);
create index if not exists drafts_tenant_status on drafts (tenant_id, status);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  draft_id uuid not null references drafts(id) on delete cascade,
  user_id uuid not null references users(id),
  action text not null check (action in ('approve','edit_approve','escalate','reject')),
  note text not null default '',
  created_at timestamptz not null default now()
);

-- One row per real send. unique(draft_id) makes a double send impossible.
create table if not exists sent_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  draft_id uuid not null unique references drafts(id) on delete cascade,
  approval_id uuid not null references approvals(id),
  provider text not null,
  provider_message_id text,
  to_addr text not null,
  subject text not null,
  body text not null,
  sent_at timestamptz not null default now()
);

create table if not exists calendar_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  draft_id uuid references drafts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'held' check (status in ('held','released')),
  created_at timestamptz not null default now(),
  -- No two active holds for the same tenant may overlap: double-booking is impossible at the database level.
  exclude using gist (
    tenant_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'held')
);

create table if not exists kb_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists kb_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  document_id uuid not null references kb_documents(id) on delete cascade,
  ordinal int not null,
  content text not null,
  embedding vector(256) not null
);
create index if not exists kb_chunks_tenant on kb_chunks (tenant_id);

create table if not exists briefs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('daily','radar')),
  brief_date date not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, kind, brief_date)
);

create table if not exists news_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('news','competitor')),
  source text not null,
  title text not null,
  url text not null default '',
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, kind, content_hash)
);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task text not null,
  route text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_tenant_time on usage_events (tenant_id, created_at);

create table if not exists audit_log (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor text not null,
  action text not null,
  subject_id text,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists audit_tenant_time on audit_log (tenant_id, created_at desc);

create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
