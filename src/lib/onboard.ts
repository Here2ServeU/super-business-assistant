import { readFileSync } from "node:fs";
import { z } from "zod";
import { systemDb, tenantDb } from "@/lib/dal";
import { ingestDocument } from "@/lib/kb";
import { NORTH_STAR_KB } from "@/lib/mail/demo-fixtures";
import { ProfileSchema } from "@/lib/settings";

// Onboard a tenant from an onboarding/*.json file (see onboarding/template.json).

export const OnboardingSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  shadowMode: z.boolean().default(true),
  demoMailbox: z.boolean().default(false),
  profile: ProfileSchema,
  kb: z.union([z.literal("demo"), z.array(z.object({ title: z.string(), content: z.string() }))]).default([]),
});
export type Onboarding = z.infer<typeof OnboardingSchema>;

export function readOnboarding(path: string): Onboarding {
  return OnboardingSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export async function onboard(o: Onboarding, opts: { reset?: boolean; approverEmails?: { name: string; email: string }[] } = {}) {
  const existing = await systemDb.tenantBySlug(o.slug);
  if (existing && !opts.reset) return { tenantId: existing.id, created: false };
  const profile = { ...o.profile, approvers: o.profile.approvers.length ? o.profile.approvers : opts.approverEmails ?? [] };
  const tenantId = await systemDb.upsertTenant({ slug: o.slug, name: o.name, profile, shadowMode: o.shadowMode });
  if (opts.reset) await systemDb.resetTenantData(tenantId);
  const db = tenantDb(tenantId);
  await db.setPaused(false);
  const docs = o.kb === "demo" ? NORTH_STAR_KB : o.kb;
  for (const d of docs) await ingestDocument(db, d.title, d.content, "onboarding");
  if (o.demoMailbox) await db.upsertConnection({ provider: "demo", accountEmail: "office@northstar.example", tokenCiphertext: null, scopes: "demo" });
  await db.audit("onboarding", "tenant_onboarded", tenantId, `${o.name}${o.shadowMode ? " (shadow mode)" : ""}`);
  return { tenantId, created: true };
}
