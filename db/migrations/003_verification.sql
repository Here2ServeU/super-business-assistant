-- Email + phone verification for self-signup.
alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists phone text;
alter table users add column if not exists phone_verified_at timestamptz;

-- Everyone who existed before verification was introduced was created by an operator: treat as verified.
update users set email_verified_at = coalesce(email_verified_at, created_at), phone_verified_at = coalesce(phone_verified_at, created_at)
  where email_verified_at is null;

-- One row per code or link we send. Codes and link tokens are stored only as hashes.
create table if not exists verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('email','phone')),
  target text not null,                 -- the email address or phone number it was sent to
  code_hash text,                       -- null when the SMS provider (Twilio Verify) holds the code
  token_hash text,                      -- email link token
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists verification_codes_user on verification_codes (user_id, kind, created_at desc);
create unique index if not exists verification_codes_token on verification_codes (token_hash) where token_hash is not null;
