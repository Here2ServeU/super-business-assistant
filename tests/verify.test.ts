import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/db/client";
import { systemDb } from "@/lib/dal";
import { signUp, type SignupInput } from "@/lib/signup";
import { devOutbox } from "@/lib/verify/channels";
import {
  changeEmail, changePhone, confirmEmailCode, confirmEmailLink, confirmPhoneCode, normalizePhone, sendPhoneCode, verificationState,
} from "@/lib/verify";

const input = (over: Partial<SignupInput> = {}): SignupInput => ({
  name: "Sam Lee", email: `sam+${Math.random().toString(36).slice(2)}@example.com`, mobile: "605-555-0142", password: "correct horse battery",
  businessName: "Lee Auto", businessType: "auto_repair", timezone: "America/Chicago", phone: "", website: "", accessCode: "", agree: "on", ...over,
});

const lastCode = (kind: "email" | "phone", to: string) => [...devOutbox].reverse().find((m) => m.kind === kind && m.to === to)!;

async function newUser(over: Partial<SignupInput> = {}) {
  const i = input(over);
  const r = await signUp(i);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { ...r, email: i.email.toLowerCase() };
}

/** Make the last code look older, to test cooldowns and expiry without waiting. */
async function age(userId: string, kind: string, minutes: number) {
  const sql = getSql();
  await sql`update verification_codes set created_at = created_at - make_interval(mins => ${minutes}) where user_id = ${userId} and kind = ${kind}`;
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  devOutbox.length = 0;
});
afterAll(closeSql);

describe("Email then phone verification after signup", () => {
  it("signup sends an email code; email then phone codes complete verification", async () => {
    const u = await newUser();
    expect((await verificationState(u.userId))!.step).toBe("email");
    const mail = lastCode("email", u.email);
    expect(mail.code).toMatch(/^\d{6}$/);
    expect(mail.link).toMatch(/\/verify\/email\?t=/);

    expect((await confirmPhoneCode(u.userId, "123456")).ok).toBe(false); // phone can't come first
    expect((await confirmEmailCode(u.userId, mail.code)).ok).toBe(true);
    expect((await verificationState(u.userId))!.step).toBe("phone");

    expect((await sendPhoneCode(u.userId)).ok).toBe(true);
    const sms = lastCode("phone", "+16055550142");
    expect((await confirmPhoneCode(u.userId, "000000")).ok).toBe(false);
    expect((await confirmPhoneCode(u.userId, sms.code)).ok).toBe(true);
    expect((await verificationState(u.userId))!.step).toBe("done");

    const u2 = await systemDb.userById(u.userId);
    expect(u2!.email_verified_at).toBeTruthy();
    expect(u2!.phone_verified_at).toBeTruthy();
    const tenant = (await systemDb.tenantsForUser(u.userId))[0];
    const { tenantDb } = await import("@/lib/dal");
    const actions = (await tenantDb(tenant.id).listAudit()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["email_code_sent", "email_verified", "phone_code_sent", "phone_verified"]));
  });

  it("codes are stored only as hashes", async () => {
    const u = await newUser();
    const code = lastCode("email", u.email).code;
    const sql = getSql();
    const rows = await sql`select (v.*)::text as row from verification_codes v where user_id = ${u.userId}`;
    for (const r of rows) expect(r.row).not.toContain(code);
  });

  it("the email link works once, and only for the address it was sent to", async () => {
    const u = await newUser();
    const token = new URL(lastCode("email", u.email).link!).searchParams.get("t")!;
    expect(await confirmEmailLink(token)).toMatchObject({ ok: true, userId: u.userId });
    expect((await confirmEmailLink(token)).ok).toBe(false);
    expect((await confirmEmailLink("not-a-real-token-at-all-xxxxxxxx")).ok).toBe(false);
  });

  it("locks a code after 5 wrong tries, and expires it after 15 minutes", async () => {
    const u = await newUser();
    const code = lastCode("email", u.email).code;
    for (let i = 0; i < 5; i++) expect((await confirmEmailCode(u.userId, "000000")).ok).toBe(false);
    const locked = await confirmEmailCode(u.userId, code);
    expect(locked).toMatchObject({ ok: false, error: expect.stringMatching(/Too many tries/) });

    const v = await newUser();
    await age(v.userId, "email", 16);
    expect(await confirmEmailCode(v.userId, lastCode("email", v.email).code)).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
  });

  it("rate-limits resends", async () => {
    const u = await newUser();
    const { sendEmailCode } = await import("@/lib/verify");
    expect(await sendEmailCode(u.userId)).toMatchObject({ ok: false, error: expect.stringMatching(/wait/) });
    await age(u.userId, "email", 1);
    expect((await sendEmailCode(u.userId)).ok).toBe(true);
  });

  it("fixing a typo in the email sends a new code; the old code no longer works", async () => {
    const u = await newUser();
    const old = lastCode("email", u.email).code;
    const fixed = `fixed+${Math.random().toString(36).slice(2)}@example.com`;
    expect((await changeEmail(u.userId, fixed)).ok).toBe(true);
    expect((await confirmEmailCode(u.userId, old)).ok).toBe(false);
    expect((await confirmEmailCode(u.userId, lastCode("email", fixed).code)).ok).toBe(true);
    expect((await systemDb.userVerification(u.userId))!.email).toBe(fixed);
  });

  it("refuses changing to an email another account uses", async () => {
    const a = await newUser();
    const b = await newUser();
    expect(await changeEmail(b.userId, a.email)).toMatchObject({ ok: false, error: expect.stringMatching(/already uses/) });
  });

  it("using a different mobile number texts the new number; the old code no longer works", async () => {
    const u = await newUser();
    await confirmEmailCode(u.userId, lastCode("email", u.email).code);
    await sendPhoneCode(u.userId);
    const old = lastCode("phone", "+16055550142").code;
    await age(u.userId, "phone", 1);
    expect((await changePhone(u.userId, "(212) 555-0101")).ok).toBe(true);
    expect((await confirmPhoneCode(u.userId, old)).ok).toBe(false);
    expect((await confirmPhoneCode(u.userId, lastCode("phone", "+12125550101").code)).ok).toBe(true);
    expect((await systemDb.userVerification(u.userId))!.phone).toBe("+12125550101");
  });

  it("normalizes phone numbers", () => {
    expect(normalizePhone("(605) 555-0142")).toBe("+16055550142");
    expect(normalizePhone("1 605 555 0142")).toBe("+16055550142");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("555-0142")).toBeNull();
    expect(normalizePhone("(105) 555-0142")).toBeNull();
  });

  it("on Vercel without email/text providers, signup stops and creates nothing", async () => {
    process.env.VERCEL_ENV = "production";
    const i = input();
    const r = await signUp(i);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.form).toMatch(/temporarily unavailable/);
    expect(await systemDb.userByEmail(i.email)).toBeNull();
  });

  it("operator-created logins (seed) count as verified", async () => {
    const id = await systemDb.upsertUser({ email: `op+${Date.now()}@example.com`, name: "Op", passwordHash: "x" });
    expect((await verificationState(id))!.step).toBe("done");
  });
});
