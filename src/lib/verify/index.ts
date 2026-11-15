import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { systemDb } from "@/lib/dal";
import { env } from "@/lib/env";
import { emailChannel, smsChannel, VerificationUnavailable } from "./channels";

// After signup: verify the email address, then the mobile number.
// Codes are 6 digits, single-use, expire in 15 minutes, allow 5 tries, and are
// stored only as keyed hashes. Sending is rate-limited per user.

export { VerificationUnavailable };

const CODE_TTL_MIN = 15;
const LINK_TTL_MIN = 60 * 24;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 30;
const MAX_SENDS_PER_HOUR = 5;

const hash = (s: string) => createHmac("sha256", env.authSecret()).update(s).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type Step = "email" | "phone" | "done";
export type Result = { ok: true } | { ok: false; error: string };

export async function verificationState(userId: string) {
  const u = await systemDb.userVerification(userId);
  if (!u) return null;
  const step: Step = !u.email_verified_at ? "email" : !u.phone_verified_at ? "phone" : "done";
  return { step, email: u.email, phone: u.phone, name: u.name };
}

export function isVerified(u: { email_verified_at: Date | null; phone_verified_at: Date | null }) {
  return !!u.email_verified_at && !!u.phone_verified_at;
}

/** Turn what people type into E.164 (+15551234567). US numbers may be typed without +1. */
export function normalizePhone(input: string): string | null {
  const t = input.trim();
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1") && /^1[2-9]\d{2}[2-9]/.test(digits)) return `+${digits}`;
  return null;
}

export function maskPhone(p: string | null) {
  return p ? `•••• ${p.slice(-4)}` : "";
}

async function rateLimit(userId: string, kind: "email" | "phone"): Promise<string | null> {
  const last = await systemDb.latestCode(userId, kind);
  if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_COOLDOWN_S * 1000) return `Please wait ${RESEND_COOLDOWN_S} seconds before asking for another code.`;
  if ((await systemDb.codesSentSince(userId, kind, new Date(Date.now() - 3600_000))) >= MAX_SENDS_PER_HOUR) return "Too many codes requested. Please try again in an hour.";
  return null;
}

// ---------------- email ----------------
export async function sendEmailCode(userId: string, opts: { force?: boolean } = {}): Promise<Result> {
  const u = await systemDb.userVerification(userId);
  if (!u) return { ok: false, error: "Account not found." };
  if (u.email_verified_at) return { ok: true };
  if (!opts.force) {
    const limited = await rateLimit(userId, "email");
    if (limited) return { ok: false, error: limited };
  }
  const channel = emailChannel(); // throws VerificationUnavailable on Vercel without keys
  const code = String(randomInt(100000, 1000000));
  const token = randomBytes(32).toString("base64url");
  await systemDb.insertCode({ userId, kind: "email", target: u.email, codeHash: hash(`email:${userId}:${code}`), tokenHash: hash(`link:${token}`), expiresAt: new Date(Date.now() + LINK_TTL_MIN * 60_000) });
  const link = `${env.appUrl()}/verify/email?t=${token}`;
  const first = u.name.split(/\s+/)[0] || "there";
  await channel.send(
    {
      to: u.email,
      subject: `${code} is your Super Business Assistant code`,
      text: `Hi ${first},\n\nYour code is ${code}. It works for ${CODE_TTL_MIN} minutes.\n\nOr confirm with this link:\n${link}\n\nIf you didn't sign up, you can ignore this email.\n\nSuper Business Assistant · Secure AI. Lower cost.`,
      html: `<div style="font-family:Inter,Arial,sans-serif;color:#12172B;max-width:480px">
        <p>Hi ${first.replace(/[<>&"]/g, "")},</p><p>Your code is</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0">${code}</p>
        <p>It works for ${CODE_TTL_MIN} minutes. Or confirm with one tap:</p>
        <p><a href="${link}" style="background:#F08A2B;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">Confirm my email</a></p>
        <p style="color:#5A6172;font-size:13px">If you didn't sign up, you can ignore this email.<br>Super Business Assistant · Secure AI. Lower cost.</p></div>`,
    },
    code,
    link,
  );
  await systemDb.auditForUser(userId, "email_code_sent", `${u.email} via ${channel.name}`);
  return { ok: true };
}

export async function confirmEmailCode(userId: string, code: string): Promise<Result> {
  const u = await systemDb.userVerification(userId);
  if (!u) return { ok: false, error: "Account not found." };
  if (u.email_verified_at) return { ok: true };
  const c = await systemDb.latestCode(userId, "email");
  const clean = code.replace(/\D/g, "");
  if (!c || c.consumed_at || c.target.toLowerCase() !== u.email.toLowerCase()) return { ok: false, error: "Ask for a new code." };
  if (Date.now() - new Date(c.created_at).getTime() > CODE_TTL_MIN * 60_000) return { ok: false, error: "That code has expired. Ask for a new one." };
  if (c.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many tries. Ask for a new code." };
  if (!c.code_hash || !same(c.code_hash, hash(`email:${userId}:${clean}`))) {
    const n = await systemDb.bumpAttempts(c.id);
    return { ok: false, error: n >= MAX_ATTEMPTS ? "Too many tries. Ask for a new code." : "That code isn't right. Check the email and try again." };
  }
  if (!(await systemDb.consumeCode(c.id))) return { ok: false, error: "That code was already used." };
  await systemDb.markEmailVerified(userId, c.target);
  await systemDb.auditForUser(userId, "email_verified", u.email);
  return { ok: true };
}

/** The one-tap link in the email. Works once, for 24 hours, only for the address it was sent to. */
export async function confirmEmailLink(token: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, error: "That link isn't valid." };
  const c = await systemDb.codeByToken(hash(`link:${token}`));
  if (!c) return { ok: false, error: "That link isn't valid." };
  if (c.consumed_at) return { ok: false, error: "That link was already used." };
  if (new Date(c.expires_at).getTime() < Date.now()) return { ok: false, error: "That link has expired." };
  if (!(await systemDb.consumeCode(c.id))) return { ok: false, error: "That link was already used." };
  if (!(await systemDb.markEmailVerified(c.user_id, c.target))) return { ok: false, error: "That link is for an old email address." };
  await systemDb.auditForUser(c.user_id, "email_verified", `${c.target} (link)`);
  return { ok: true, userId: c.user_id };
}

export async function changeEmail(userId: string, email: string): Promise<Result> {
  const u = await systemDb.userVerification(userId);
  if (!u) return { ok: false, error: "Account not found." };
  if (u.email_verified_at) return { ok: false, error: "Your email is already confirmed." };
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) return { ok: false, error: "Enter a valid email address." };
  if (e === u.email.toLowerCase()) return sendEmailCode(userId);
  if (!(await systemDb.changeEmail(userId, e))) return { ok: false, error: "Another account already uses that email." };
  await systemDb.auditForUser(userId, "email_changed", `${u.email} → ${e}`);
  return sendEmailCode(userId, { force: true });
}

// ---------------- phone ----------------
export async function sendPhoneCode(userId: string): Promise<Result> {
  const u = await systemDb.userVerification(userId);
  if (!u) return { ok: false, error: "Account not found." };
  if (!u.email_verified_at) return { ok: false, error: "Confirm your email first." };
  if (u.phone_verified_at) return { ok: true };
  if (!u.phone) return { ok: false, error: "Add your mobile number." };
  const limited = await rateLimit(userId, "phone");
  if (limited) return { ok: false, error: limited };
  const channel = smsChannel();
  try {
    const { localCode } = await channel.start(u.phone);
    await systemDb.insertCode({ userId, kind: "phone", target: u.phone, codeHash: localCode ? hash(`phone:${userId}:${localCode}`) : null, tokenHash: null, expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000) });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  await systemDb.auditForUser(userId, "phone_code_sent", `${maskPhone(u.phone)} via ${channel.name}`);
  return { ok: true };
}

export async function confirmPhoneCode(userId: string, code: string): Promise<Result> {
  const u = await systemDb.userVerification(userId);
  if (!u) return { ok: false, error: "Account not found." };
  if (u.phone_verified_at) return { ok: true };
  if (!u.email_verified_at) return { ok: false, error: "Confirm your email first." };
  const c = await systemDb.latestCode(userId, "phone");
  const clean = code.replace(/\D/g, "");
  if (!c || c.consumed_at || c.target !== u.phone) return { ok: false, error: "Ask for a new code." };
  if (new Date(c.expires_at).getTime() < Date.now()) return { ok: false, error: "That code has expired. Ask for a new one." };
  if (c.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many tries. Ask for a new code." };
  let good: boolean;
  if (c.code_hash) good = same(c.code_hash, hash(`phone:${userId}:${clean}`));
  else {
    const channel = smsChannel();
    good = clean.length >= 4 && !!channel.check && (await channel.check(c.target, clean));
  }
  if (!good) {
    const n = await systemDb.bumpAttempts(c.id);
    return { ok: false, error: n >= MAX_ATTEMPTS ? "Too many tries. Ask for a new code." : "That code isn't right. Check the text and try again." };
  }
  if (!(await systemDb.consumeCode(c.id))) return { ok: false, error: "That code was already used." };
  await systemDb.markPhoneVerified(userId, c.target);
  await systemDb.auditForUser(userId, "phone_verified", maskPhone(c.target));
  return { ok: true };
}

export async function changePhone(userId: string, input: string): Promise<Result> {
  const u = await systemDb.userVerification(userId);
  if (!u) return { ok: false, error: "Account not found." };
  if (u.phone_verified_at) return { ok: false, error: "Your number is already confirmed." };
  const p = normalizePhone(input);
  if (!p) return { ok: false, error: "Enter a mobile number, like (605) 555-0123." };
  if (p !== u.phone) {
    await systemDb.setPhone(userId, p);
    await systemDb.auditForUser(userId, "phone_changed", maskPhone(p));
  }
  return sendPhoneCode(userId);
}
