import { getSql } from "@/lib/db/client";
import { systemDb, tenantDb, type TenantDb } from "@/lib/dal";
import { demoProvider } from "@/lib/mail/providers";
import type { MailProvider } from "@/lib/mail/types";
import { onboard, readOnboarding } from "@/lib/onboard";
import { processTenant } from "@/lib/pipeline";
import type { Profile } from "@/lib/settings";

export async function freshNorthStar() {
  const o = readOnboarding("onboarding/north-star.json");
  const { tenantId } = await onboard(o, { reset: true });
  const db = tenantDb(tenantId);
  await db.setShadowMode(false);
  await db.setPaused(false);
  await db.saveProfile(o.profile);
  const provider = recordingProvider(db);
  const run = await processTenant(db, provider);
  const owner = await user("owner@northstar.example", tenantId, "owner");
  return { db, provider, run, owner };
}

export async function otherTenant(slug: string, overrides: Partial<{ shadowMode: boolean; profile: Partial<Profile> }> = {}) {
  const o = readOnboarding("onboarding/north-star.json");
  const { tenantId } = await onboard({ ...o, slug, name: `Test ${slug}`, shadowMode: overrides.shadowMode ?? false, profile: { ...o.profile, ...overrides.profile } }, { reset: true });
  const db = tenantDb(tenantId);
  await db.setPaused(false);
  await db.setShadowMode(overrides.shadowMode ?? false);
  const owner = await user(`owner@${slug}.example`, tenantId, "owner");
  return { db, provider: recordingProvider(db), owner };
}

export async function user(email: string, tenantId: string, role: "owner" | "approver" | "viewer") {
  const id = await systemDb.upsertUser({ email, name: email.split("@")[0], passwordHash: "x" });
  await systemDb.addMember(tenantId, id, role);
  return { userId: id, email, role };
}

/** The demo mailbox, plus a record of every send that actually reached it. */
export function recordingProvider(db: TenantDb): MailProvider & { sent: { to: string; body: string }[]; failNext: boolean } {
  const base = demoProvider(db);
  const p = {
    ...base,
    sent: [] as { to: string; body: string }[],
    failNext: false,
    async send(mail: Parameters<MailProvider["send"]>[0], proof: Parameters<MailProvider["send"]>[1]) {
      if (p.failNext) {
        p.failNext = false;
        throw new Error("simulated crash before the mailbox accepted the message");
      }
      const r = await base.send(mail, proof);
      p.sent.push({ to: mail.to, body: mail.body });
      return r;
    },
  };
  return p;
}

export async function draftFor(db: TenantDb, providerMessageId: string) {
  const sql = getSql();
  const [row] = await sql<{ id: string }[]>`select d.id from drafts d join messages m on m.id = d.message_id
    where d.tenant_id = ${db.tenantId} and m.provider_message_id = ${providerMessageId}`;
  if (!row) throw new Error(`no draft for ${providerMessageId}`);
  return (await db.draft(row.id))!;
}

export async function sentCount(db: TenantDb) {
  return (await db.listSent(1000)).length;
}
