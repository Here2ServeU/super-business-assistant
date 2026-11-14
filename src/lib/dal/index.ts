import type postgres from "postgres";
import { getSql } from "@/lib/db/client";
import { mask } from "@/lib/guard";
import { ProfileSchema, type Profile, type TenantSettings } from "@/lib/settings";

// The single data-access layer. Every tenant query is built from tenantDb(tenantId),
// which injects tenant_id into every WHERE clause and every INSERT. There is no
// other path to the database for app code (enforced by tests/architecture.test.ts).

type Sql = postgres.Sql | postgres.TransactionSql;
type Row = Record<string, unknown>;

export type Role = "owner" | "approver" | "viewer";
export type DraftStatus = "pending" | "approved" | "edited" | "rejected" | "escalated" | "sent";
export type MessageStatus = "new" | "sorted" | "drafted" | "escalated" | "no_reply" | "waiting_budget" | "done";

export interface MessageRow {
  id: string;
  tenant_id: string;
  provider: string;
  provider_message_id: string;
  thread_id: string | null;
  from_addr: string;
  from_name: string;
  to_addr: string;
  subject: string;
  body: string;
  received_at: Date;
  masked_flags: string[];
  injection_suspected: boolean;
  category: string | null;
  urgent: boolean;
  language: string;
  status: MessageStatus;
  escalation_reason: string | null;
}

export interface Source {
  chunkId: string;
  documentId: string;
  title: string;
  excerpt: string;
}

export interface Slot {
  start: string;
  end: string;
  label: string;
}

export interface DraftRow {
  id: string;
  tenant_id: string;
  message_id: string;
  status: DraftStatus;
  to_addr: string;
  subject: string;
  body: string;
  final_body: string | null;
  model: string;
  sources: Source[];
  proposed_slots: Slot[];
  escalate: boolean;
  escalation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  subject_id: string | null;
  detail: string;
  created_at: Date;
}

export interface ConnectionRow {
  id: string;
  provider: "gmail" | "microsoft" | "demo";
  account_email: string;
  token_ciphertext: string | null;
  scopes: string;
  status: string;
  last_synced_at: Date | null;
}

const vec = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;

export function tenantDb(tenantId: string, sql: Sql = getSql()) {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error("tenantDb: invalid tenant id");
  const t = tenantId;

  const db = {
    tenantId: t,

    // ---------- tenant + settings ----------
    async tenant() {
      const [row] = await sql<{ id: string; slug: string; name: string }[]>`select id, slug, name from tenants where id = ${t}`;
      return row ?? null;
    },
    async settings(): Promise<TenantSettings> {
      const [row] = await sql<{ profile: unknown; paused: boolean; shadow_mode: boolean }[]>`
        select profile, paused, shadow_mode from tenant_settings where tenant_id = ${t}`;
      if (!row) throw new Error("tenant settings missing");
      return { profile: ProfileSchema.parse(row.profile), paused: row.paused, shadowMode: row.shadow_mode };
    },
    async saveProfile(profile: Profile) {
      const p = ProfileSchema.parse(profile);
      await sql`update tenant_settings set profile = ${sql.json(p as never)}, updated_at = now() where tenant_id = ${t}`;
    },
    async setPaused(paused: boolean) {
      await sql`update tenant_settings set paused = ${paused}, updated_at = now() where tenant_id = ${t}`;
    },
    async setShadowMode(on: boolean) {
      await sql`update tenant_settings set shadow_mode = ${on}, updated_at = now() where tenant_id = ${t}`;
    },
    async members() {
      return sql<{ user_id: string; email: string; name: string; role: Role }[]>`
        select m.user_id, u.email, u.name, m.role from tenant_members m join users u on u.id = m.user_id
        where m.tenant_id = ${t} order by m.role, u.email`;
    },
    async memberRole(userId: string): Promise<Role | null> {
      const [row] = await sql<{ role: Role }[]>`select role from tenant_members where tenant_id = ${t} and user_id = ${userId}`;
      return row?.role ?? null;
    },

    // ---------- mail connections ----------
    async connection(provider?: string): Promise<ConnectionRow | null> {
      const rows = provider
        ? await sql<ConnectionRow[]>`select * from mail_connections where tenant_id = ${t} and provider = ${provider}`
        : await sql<ConnectionRow[]>`select * from mail_connections where tenant_id = ${t} and status = 'active'
            order by case provider when 'gmail' then 0 when 'microsoft' then 1 else 2 end, created_at limit 1`;
      return rows[0] ?? null;
    },
    async upsertConnection(c: { provider: string; accountEmail: string; tokenCiphertext: string | null; scopes: string }) {
      await sql`
        insert into mail_connections (tenant_id, provider, account_email, token_ciphertext, scopes, status)
        values (${t}, ${c.provider}, ${c.accountEmail}, ${c.tokenCiphertext}, ${c.scopes}, 'active')
        on conflict (tenant_id, provider) do update set account_email = excluded.account_email,
          token_ciphertext = excluded.token_ciphertext, scopes = excluded.scopes, status = 'active'`;
    },
    async updateConnectionToken(provider: string, tokenCiphertext: string) {
      await sql`update mail_connections set token_ciphertext = ${tokenCiphertext} where tenant_id = ${t} and provider = ${provider}`;
    },
    async markSynced(provider: string) {
      await sql`update mail_connections set last_synced_at = now() where tenant_id = ${t} and provider = ${provider}`;
    },

    // ---------- messages ----------
    /** Insert a GUARDED message. Returns null when it was already ingested. */
    async insertMessage(m: {
      provider: string; providerMessageId: string; threadId: string | null; fromAddr: string; fromName: string;
      toAddr: string; subject: string; body: string; receivedAt: Date; maskedFlags: string[];
      injectionSuspected: boolean; language: string;
    }): Promise<MessageRow | null> {
      const rows = await sql<MessageRow[]>`
        insert into messages (tenant_id, provider, provider_message_id, thread_id, from_addr, from_name, to_addr,
          subject, body, received_at, masked_flags, injection_suspected, language)
        values (${t}, ${m.provider}, ${m.providerMessageId}, ${m.threadId}, ${m.fromAddr}, ${m.fromName}, ${m.toAddr},
          ${m.subject}, ${m.body}, ${m.receivedAt}, ${m.maskedFlags}, ${m.injectionSuspected}, ${m.language})
        on conflict (tenant_id, provider, provider_message_id) do nothing
        returning *`;
      return rows[0] ?? null;
    },
    async message(id: string): Promise<MessageRow | null> {
      const [row] = await sql<MessageRow[]>`select * from messages where tenant_id = ${t} and id = ${id}`;
      return row ?? null;
    },
    async messagesByStatus(statuses: MessageStatus[], limit = 25): Promise<MessageRow[]> {
      return sql<MessageRow[]>`select * from messages where tenant_id = ${t} and status = any(${statuses})
        order by received_at asc limit ${limit}`;
    },
    async listMessages(opts: { category?: string; limit?: number } = {}): Promise<MessageRow[]> {
      const limit = opts.limit ?? 100;
      return opts.category
        ? sql<MessageRow[]>`select * from messages where tenant_id = ${t} and category = ${opts.category} order by received_at desc limit ${limit}`
        : sql<MessageRow[]>`select * from messages where tenant_id = ${t} order by received_at desc limit ${limit}`;
    },
    async updateMessage(id: string, fields: Partial<Pick<MessageRow, "category" | "urgent" | "status" | "escalation_reason">>) {
      const keys = Object.keys(fields) as (keyof typeof fields)[];
      if (!keys.length) return;
      await sql`update messages set ${sql(fields as Row, keys as string[])} where tenant_id = ${t} and id = ${id}`;
    },

    // ---------- drafts ----------
    async insertDraft(d: {
      messageId: string; status: DraftStatus; toAddr: string; subject: string; body: string; model: string;
      sources: Source[]; proposedSlots: Slot[]; escalate: boolean; escalationReason: string | null;
    }): Promise<DraftRow | null> {
      const rows = await sql<DraftRow[]>`
        insert into drafts (tenant_id, message_id, status, to_addr, subject, body, model, sources, proposed_slots, escalate, escalation_reason)
        values (${t}, ${d.messageId}, ${d.status}, ${d.toAddr}, ${d.subject}, ${d.body}, ${d.model},
          ${sql.json(d.sources as never)}, ${sql.json(d.proposedSlots as never)}, ${d.escalate}, ${d.escalationReason})
        on conflict (tenant_id, message_id) do nothing
        returning *`;
      return rows[0] ?? null;
    },
    async draft(id: string): Promise<DraftRow | null> {
      const [row] = await sql<DraftRow[]>`select * from drafts where tenant_id = ${t} and id = ${id}`;
      return row ?? null;
    },
    /** Row-locks a draft for a human decision. Must be called inside tx(). */
    async lockDraft(id: string): Promise<DraftRow | null> {
      const [row] = await sql<DraftRow[]>`select * from drafts where tenant_id = ${t} and id = ${id} for update`;
      return row ?? null;
    },
    async listDrafts(statuses: DraftStatus[], limit = 50) {
      return sql<(DraftRow & { m_subject: string; m_body: string; m_from: string; m_from_name: string; m_received_at: Date; m_category: string | null; m_urgent: boolean; m_flags: string[]; m_injection: boolean })[]>`
        select d.*, m.subject as m_subject, m.body as m_body, m.from_addr as m_from, m.from_name as m_from_name,
          m.received_at as m_received_at, m.category as m_category, m.urgent as m_urgent, m.masked_flags as m_flags,
          m.injection_suspected as m_injection
        from drafts d join messages m on m.id = d.message_id and m.tenant_id = d.tenant_id
        where d.tenant_id = ${t} and d.status = any(${statuses})
        order by m.urgent desc, d.created_at asc limit ${limit}`;
    },
    async updateDraft(id: string, fields: Partial<Pick<DraftRow, "status" | "final_body" | "escalate" | "escalation_reason">>) {
      const keys = Object.keys(fields) as string[];
      if (!keys.length) return;
      await sql`update drafts set ${sql(fields as Row, keys)}, updated_at = now() where tenant_id = ${t} and id = ${id}`;
    },

    // ---------- approvals + sends ----------
    async insertApproval(a: { draftId: string; userId: string; action: "approve" | "edit_approve" | "escalate" | "reject"; note?: string }) {
      const [row] = await sql<{ id: string }[]>`
        insert into approvals (tenant_id, draft_id, user_id, action, note)
        values (${t}, ${a.draftId}, ${a.userId}, ${a.action}, ${a.note ?? ""}) returning id`;
      return row.id;
    },
    async approvalFor(draftId: string) {
      const [row] = await sql<{ id: string; action: string; user_id: string }[]>`
        select id, action, user_id from approvals where tenant_id = ${t} and draft_id = ${draftId}
          and action in ('approve','edit_approve') order by created_at desc limit 1`;
      return row ?? null;
    },
    /** Atomically claim the right to send this draft. Returns null if another send holds or completed it. */
    async claimSend(s: { draftId: string; approvalId: string; provider: string; toAddr: string; subject: string; body: string }) {
      const rows = await sql<{ id: string }[]>`
        insert into sent_messages (tenant_id, draft_id, approval_id, provider, to_addr, subject, body, status)
        values (${t}, ${s.draftId}, ${s.approvalId}, ${s.provider}, ${s.toAddr}, ${s.subject}, ${s.body}, 'sending')
        on conflict (draft_id) do update set status = 'sending', approval_id = excluded.approval_id, body = excluded.body,
          subject = excluded.subject, provider = excluded.provider, error = null, sent_at = now()
          where sent_messages.status = 'failed' and sent_messages.tenant_id = ${t}
        returning id`;
      return rows[0]?.id ?? null;
    },
    async completeSend(id: string, providerMessageId: string | null) {
      await sql`update sent_messages set status = 'sent', provider_message_id = ${providerMessageId}, sent_at = now() where tenant_id = ${t} and id = ${id}`;
    },
    async failSend(id: string, error: string) {
      await sql`update sent_messages set status = 'failed', error = ${mask(error).slice(0, 500)} where tenant_id = ${t} and id = ${id}`;
    },
    /** The send record for a draft in any state (sending / sent / failed). */
    async sendState(draftId: string) {
      const [row] = await sql<{ id: string; status: "sending" | "sent" | "failed"; body: string }[]>`
        select id, status, body from sent_messages where tenant_id = ${t} and draft_id = ${draftId}`;
      return row ?? null;
    },
    /** Completed sends only. */
    async sentFor(draftId: string) {
      const [row] = await sql<{ id: string; body: string }[]>`select id, body from sent_messages where tenant_id = ${t} and draft_id = ${draftId} and status = 'sent'`;
      return row ?? null;
    },
    async listSent(limit = 100) {
      return sql<{ id: string; draft_id: string; to_addr: string; subject: string; body: string; sent_at: Date }[]>`
        select id, draft_id, to_addr, subject, body, sent_at from sent_messages where tenant_id = ${t} and status = 'sent' order by sent_at desc limit ${limit}`;
    },

    // ---------- calendar holds ----------
    async activeHolds(from: Date, to: Date) {
      return sql<{ id: string; starts_at: Date; ends_at: Date; draft_id: string | null }[]>`
        select id, starts_at, ends_at, draft_id from calendar_holds
        where tenant_id = ${t} and status = 'held' and starts_at < ${to} and ends_at > ${from}`;
    },
    /** Returns false when the slot overlaps an existing hold (the database refuses double-booking). */
    async insertHold(h: { draftId: string; start: Date; end: Date }): Promise<boolean> {
      const insert = (q: Sql) => q`insert into calendar_holds (tenant_id, draft_id, starts_at, ends_at) values (${t}, ${h.draftId}, ${h.start}, ${h.end})`;
      try {
        // Inside a transaction, use a savepoint so a refused hold doesn't abort the whole transaction.
        if ("savepoint" in sql) await sql.savepoint((sp) => insert(sp));
        else await insert(sql);
        return true;
      } catch (e) {
        if ((e as { code?: string }).code === "23P01") return false; // exclusion_violation
        throw e;
      }
    },
    async releaseHolds(draftId: string) {
      await sql`update calendar_holds set status = 'released' where tenant_id = ${t} and draft_id = ${draftId}`;
    },

    // ---------- knowledge base ----------
    async insertDocument(title: string, content: string) {
      const [row] = await sql<{ id: string }[]>`insert into kb_documents (tenant_id, title, content) values (${t}, ${title}, ${content}) returning id`;
      return row.id;
    },
    async insertChunks(documentId: string, chunks: { ordinal: number; content: string; embedding: number[] }[]) {
      for (const c of chunks) {
        await sql`insert into kb_chunks (tenant_id, document_id, ordinal, content, embedding)
          values (${t}, ${documentId}, ${c.ordinal}, ${c.content}, ${vec(c.embedding)}::vector)`;
      }
    },
    async listDocuments() {
      return sql<{ id: string; title: string; created_at: Date; chunks: number; chars: number }[]>`
        select d.id, d.title, d.created_at, length(d.content) as chars,
          (select count(*)::int from kb_chunks c where c.tenant_id = d.tenant_id and c.document_id = d.id) as chunks
        from kb_documents d where d.tenant_id = ${t} order by d.created_at`;
    },
    async deleteDocument(id: string) {
      await sql`delete from kb_documents where tenant_id = ${t} and id = ${id}`;
    },
    async searchChunks(embedding: number[], k = 5) {
      return sql<{ id: string; document_id: string; title: string; content: string; similarity: number }[]>`
        select c.id, c.document_id, d.title, c.content, 1 - (c.embedding <=> ${vec(embedding)}::vector) as similarity
        from kb_chunks c join kb_documents d on d.id = c.document_id and d.tenant_id = c.tenant_id
        where c.tenant_id = ${t}
        order by c.embedding <=> ${vec(embedding)}::vector limit ${k}`;
    },

    // ---------- briefs + news ----------
    async upsertBrief(kind: "daily" | "radar", date: string, content: unknown) {
      await sql`insert into briefs (tenant_id, kind, brief_date, content) values (${t}, ${kind}, ${date}, ${sql.json(content as never)})
        on conflict (tenant_id, kind, brief_date) do update set content = excluded.content, created_at = now()`;
    },
    async brief(kind: "daily" | "radar", date: string) {
      const [row] = await sql<{ id: string; content: unknown }[]>`select id, content from briefs where tenant_id = ${t} and kind = ${kind} and brief_date = ${date}`;
      return row ?? null;
    },
    async listBriefs(limit = 60) {
      return sql<{ id: string; kind: "daily" | "radar"; brief_date: string; content: unknown; created_at: Date }[]>`
        select id, kind, to_char(brief_date, 'YYYY-MM-DD') as brief_date, content, created_at from briefs
        where tenant_id = ${t} order by brief_date desc, kind limit ${limit}`;
    },
    async insertNews(n: { kind: "news" | "competitor"; source: string; title: string; url: string; contentHash: string }) {
      const rows = await sql<{ id: string }[]>`insert into news_items (tenant_id, kind, source, title, url, content_hash)
        values (${t}, ${n.kind}, ${n.source}, ${n.title}, ${n.url}, ${n.contentHash})
        on conflict (tenant_id, kind, content_hash) do nothing returning id`;
      return rows[0]?.id ?? null;
    },
    async latestCompetitorHash(source: string) {
      const [row] = await sql<{ content_hash: string }[]>`select content_hash from news_items where tenant_id = ${t}
        and kind = 'competitor' and source = ${source} order by created_at desc limit 1`;
      return row?.content_hash ?? null;
    },
    async newsSince(since: Date) {
      return sql<{ id: string; kind: string; source: string; title: string; url: string; created_at: Date }[]>`
        select id, kind, source, title, url, created_at from news_items where tenant_id = ${t} and created_at >= ${since}
        order by created_at desc limit 50`;
    },

    // ---------- meter ----------
    async insertUsage(u: { task: string; route: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }) {
      await sql`insert into usage_events (tenant_id, task, route, model, input_tokens, output_tokens, cost_usd)
        values (${t}, ${u.task}, ${u.route}, ${u.model}, ${u.inputTokens}, ${u.outputTokens}, ${u.costUsd})`;
    },
    async spendSince(since: Date): Promise<{ usd: number; calls: number }> {
      const [row] = await sql<{ usd: string; calls: number }[]>`select coalesce(sum(cost_usd),0)::text as usd, count(*)::int as calls
        from usage_events where tenant_id = ${t} and created_at >= ${since}`;
      return { usd: Number(row.usd), calls: row.calls };
    },
    async usageByTask(since: Date) {
      return sql<{ task: string; model: string; calls: number; usd: string }[]>`
        select task, model, count(*)::int as calls, sum(cost_usd)::text as usd from usage_events
        where tenant_id = ${t} and created_at >= ${since} group by task, model order by task`;
    },

    // ---------- logbook ----------
    /** Write to the logbook. The detail is always passed through the Guard first. */
    async audit(actor: string, action: string, subjectId?: string | null, detail = "") {
      await sql`insert into audit_log (tenant_id, actor, action, subject_id, detail)
        values (${t}, ${mask(actor)}, ${action}, ${subjectId ?? null}, ${mask(detail).slice(0, 2000)})`;
    },
    async listAudit(opts: { q?: string; limit?: number } = {}): Promise<AuditRow[]> {
      const limit = opts.limit ?? 200;
      if (opts.q) {
        const like = `%${opts.q}%`;
        return sql<AuditRow[]>`select id::text, actor, action, subject_id, detail, created_at from audit_log where tenant_id = ${t}
          and (action ilike ${like} or detail ilike ${like} or actor ilike ${like} or subject_id ilike ${like})
          order by created_at desc, id desc limit ${limit}`;
      }
      return sql<AuditRow[]>`select id::text, actor, action, subject_id, detail, created_at from audit_log where tenant_id = ${t}
        order by created_at desc, id desc limit ${limit}`;
    },
    async auditCount(action: string, since: Date) {
      const [row] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where tenant_id = ${t} and action = ${action} and created_at >= ${since}`;
      return row.n;
    },

    // ---------- dashboard ----------
    async counts(since: Date) {
      const [row] = await sql<{ received: number; drafted: number; waiting: number; sent: number; escalated: number; urgent: number }[]>`
        select
          (select count(*)::int from messages where tenant_id = ${t} and received_at >= ${since}) as received,
          (select count(*)::int from drafts where tenant_id = ${t} and created_at >= ${since}) as drafted,
          (select count(*)::int from drafts where tenant_id = ${t} and status in ('pending','escalated')) as waiting,
          (select count(*)::int from sent_messages where tenant_id = ${t} and status = 'sent' and sent_at >= ${since}) as sent,
          (select count(*)::int from drafts where tenant_id = ${t} and status = 'escalated') as escalated,
          (select count(*)::int from messages m where tenant_id = ${t} and urgent and status in ('drafted','escalated')) as urgent`;
      return row;
    },
  };
  return db;
}

export type TenantDb = ReturnType<typeof tenantDb>;

/** Run several operations atomically, still scoped to one tenant. */
export async function withTenantTx<T>(db: TenantDb, fn: (scoped: TenantDb) => Promise<T>): Promise<T> {
  return getSql().begin((tx) => fn(tenantDb(db.tenantId, tx))) as Promise<T>;
}

// ---------- system (cross-tenant, no tenant data returned) ----------
// Only identity and tenant registry lookups. Never returns messages, drafts, KB, or logs.
export const systemDb = {
  async userByEmail(email: string) {
    const sql = getSql();
    const [row] = await sql<{ id: string; email: string; name: string; password_hash: string }[]>`
      select id, email, name, password_hash from users where lower(email) = lower(${email})`;
    return row ?? null;
  },
  async userById(id: string) {
    const sql = getSql();
    const [row] = await sql<{ id: string; email: string; name: string }[]>`select id, email, name from users where id = ${id}`;
    return row ?? null;
  },
  async tenantsForUser(userId: string) {
    const sql = getSql();
    return sql<{ id: string; slug: string; name: string; role: Role }[]>`
      select t.id, t.slug, t.name, m.role from tenant_members m join tenants t on t.id = m.tenant_id
      where m.user_id = ${userId} order by t.name`;
  },
  async allTenantIds() {
    const sql = getSql();
    return sql<{ id: string; slug: string }[]>`select id, slug from tenants order by created_at`;
  },
  async tenantBySlug(slug: string) {
    const sql = getSql();
    const [row] = await sql<{ id: string; slug: string; name: string }[]>`select id, slug, name from tenants where slug = ${slug}`;
    return row ?? null;
  },
  async upsertUser(u: { email: string; name: string; passwordHash: string }) {
    const sql = getSql();
    const [row] = await sql<{ id: string }[]>`insert into users (email, name, password_hash) values (lower(${u.email}), ${u.name}, ${u.passwordHash})
      on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash returning id`;
    return row.id;
  },
  /** Create (or update) a tenant from an onboarding profile. */
  async upsertTenant(o: { slug: string; name: string; profile: Profile; shadowMode: boolean }) {
    const sql = getSql();
    const profile = ProfileSchema.parse(o.profile);
    return sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`insert into tenants (slug, name) values (${o.slug}, ${o.name})
        on conflict (slug) do update set name = excluded.name returning id`;
      await tx`insert into tenant_settings (tenant_id, profile, shadow_mode) values (${row.id}, ${tx.json(profile as never)}, ${o.shadowMode})
        on conflict (tenant_id) do update set profile = excluded.profile, shadow_mode = excluded.shadow_mode, updated_at = now()`;
      return row.id;
    });
  },
  async addMember(tenantId: string, userId: string, role: Role) {
    const sql = getSql();
    await sql`insert into tenant_members (tenant_id, user_id, role) values (${tenantId}, ${userId}, ${role})
      on conflict (tenant_id, user_id) do update set role = excluded.role`;
  },
  /**
   * Self-signup: create the user, their business (tenant + settings) and the owner
   * membership in ONE transaction. Returns null when the email is already registered.
   */
  async createAccount(a: { email: string; name: string; passwordHash: string; businessName: string; slugBase: string; profile: Profile }) {
    const sql = getSql();
    const profile = ProfileSchema.parse(a.profile);
    return sql.begin(async (tx) => {
      const [u] = await tx<{ id: string }[]>`insert into users (email, name, password_hash) values (lower(${a.email}), ${a.name}, ${a.passwordHash})
        on conflict (email) do nothing returning id`;
      if (!u) return null;
      const base = a.slugBase || "business";
      const taken = await tx<{ slug: string }[]>`select slug from tenants where slug = ${base} or slug like ${base + "-%"}`;
      const used = new Set(taken.map((r) => r.slug));
      let slug = base;
      for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
      const [t] = await tx<{ id: string }[]>`insert into tenants (slug, name) values (${slug}, ${a.businessName}) returning id`;
      await tx`insert into tenant_settings (tenant_id, profile, shadow_mode) values (${t.id}, ${tx.json(profile as never)}, true)`;
      await tx`insert into tenant_members (tenant_id, user_id, role) values (${t.id}, ${u.id}, 'owner')`;
      await tx`insert into audit_log (tenant_id, actor, action, subject_id, detail)
        values (${t.id}, ${mask(a.email)}, 'tenant_signed_up', ${t.id}, ${"self-signup; starts in shadow mode"})`;
      return { userId: u.id, tenantId: t.id, slug };
    });
  },
  async ping() {
    const sql = getSql();
    const [row] = await sql<{ ok: number; vector: boolean }[]>`select 1 as ok, exists(select 1 from pg_extension where extname = 'vector') as vector`;
    return row;
  },
  /** Test/seed helper: wipe one tenant's operational data (keeps settings and members). */
  async resetTenantData(tenantId: string) {
    const sql = getSql();
    await sql.begin(async (tx) => {
      for (const table of ["calendar_holds", "sent_messages", "approvals", "drafts", "messages", "kb_chunks", "kb_documents", "briefs", "news_items", "usage_events", "audit_log", "mail_connections"]) {
        await tx.unsafe(`delete from ${table} where tenant_id = $1`, [tenantId]);
      }
    });
  },
};
