import { afterAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { closeSql, getSql } from "@/lib/db/client";
import { systemDb, tenantDb } from "@/lib/dal";
import { signUp, slugify, type SignupInput } from "@/lib/signup";
import { processTenant } from "@/lib/pipeline";
import { storeInbound } from "@/lib/pipeline";
import { NORTH_STAR_INBOX } from "@/lib/mail/demo-fixtures";

const base = (over: Partial<SignupInput> = {}): SignupInput => ({
  name: "Dana Reyes", email: `dana+${Math.random().toString(36).slice(2)}@example.com`, password: "correct horse battery",
  businessName: "Reyes Plumbing & Drain", businessType: "home_services", timezone: "America/Denver",
  phone: "(555) 010-2000", website: "reyesplumbing.example", accessCode: "", agree: "on", ...over,
});

beforeEach(() => {
  delete process.env.SIGNUP_ACCESS_CODE;
});
afterAll(closeSql);

describe("Self-signup", () => {
  it("creates the login, the business in SHADOW MODE, and makes them its owner", async () => {
    const input = base();
    const r = await signUp(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const user = await systemDb.userByEmail(input.email);
    expect(user).toBeTruthy();
    expect(await bcrypt.compare(input.password, user!.password_hash)).toBe(true);
    expect(user!.password_hash).not.toContain(input.password);
    const db = tenantDb(r.tenantId);
    expect(await db.memberRole(r.userId)).toBe("owner");
    const s = await db.settings();
    expect(s.shadowMode).toBe(true);
    expect(s.paused).toBe(false);
    expect(s.profile.company.name).toBe("Reyes Plumbing & Drain");
    expect(s.profile.company.timezone).toBe("America/Denver");
    expect(s.profile.categories.map((c) => c.name)).toContain("Emergency");
    expect(s.profile.approvers).toEqual([{ name: "Dana Reyes", email: input.email }]);
    expect(s.profile.signature).toContain("Reyes Plumbing & Drain");
    expect(await db.listDocuments()).toHaveLength(0); // no invented facts pre-filled
    expect(await db.connection()).toBeNull(); // no mailbox until they connect one
    expect((await db.listAudit()).map((a) => a.action)).toContain("tenant_signed_up");
  });

  it("a brand-new business can't state facts or send: drafts say 'let me check' and nothing is sent", async () => {
    const r = await signUp(base());
    if (!r.ok) throw new Error("signup failed");
    const db = tenantDb(r.tenantId);
    await storeInbound(db, "demo", { ...NORTH_STAR_INBOX[1], providerMessageId: "new-1" });
    await processTenant(db, null);
    const [d] = await db.listDrafts(["pending", "escalated"]);
    expect(d.status).toBe("escalated");
    expect(d.body).toMatch(/checking on this/);
  });

  it("refuses a second account with the same email (any case) and creates no extra business", async () => {
    const input = base();
    expect((await signUp(input)).ok).toBe(true);
    const sql = getSql();
    const [{ n: before }] = await sql<{ n: number }[]>`select count(*)::int n from tenants`;
    const again = await signUp({ ...input, email: input.email.toUpperCase(), businessName: "Another Biz" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors.email).toMatch(/already exists/);
    const [{ n: after }] = await sql<{ n: number }[]>`select count(*)::int n from tenants`;
    expect(after).toBe(before);
  });

  it("validates every field and reports errors per field", async () => {
    const r = await signUp(base({ name: "", email: "nope", password: "short", businessName: "", businessType: "spaceship" as never, timezone: "Mars/Base" as never, agree: "" as never }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["agree", "businessName", "businessType", "email", "name", "password", "timezone"]);
  });

  it("requires the access code when SIGNUP_ACCESS_CODE is set", async () => {
    process.env.SIGNUP_ACCESS_CODE = "YES-2026";
    const wrong = await signUp(base({ accessCode: "nope" }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors.accessCode).toBeTruthy();
    expect((await signUp(base({ accessCode: "YES-2026" }))).ok).toBe(true);
  });

  it("gives two businesses with the same name separate, isolated tenants", async () => {
    const a = await signUp(base({ businessName: "Main Street Salon", businessType: "salon" }));
    const b = await signUp(base({ businessName: "Main Street Salon", businessType: "salon" }));
    if (!a.ok || !b.ok) throw new Error("signup failed");
    expect(a.tenantId).not.toBe(b.tenantId);
    expect(await tenantDb(b.tenantId).memberRole(a.userId)).toBeNull();
    const ta = await tenantDb(a.tenantId).tenant();
    const tb = await tenantDb(b.tenantId).tenant();
    expect(ta!.slug).not.toBe(tb!.slug);
  });

  it("makes clean slugs", () => {
    expect(slugify("Reyes Plumbing & Drain")).toBe("reyes-plumbing-and-drain");
    expect(slugify("Café Olé!!")).toBe("cafe-ole");
  });
});
