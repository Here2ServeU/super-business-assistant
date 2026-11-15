import bcrypt from "bcryptjs";
import { z } from "zod";
import { systemDb } from "@/lib/dal";
import { env } from "@/lib/env";
import { STARTERS, TIMEZONES, starterProfile } from "@/lib/starters";
import { emailChannel, smsChannel, VerificationUnavailable } from "@/lib/verify/channels";
import { normalizePhone, sendEmailCode } from "@/lib/verify";

// Self-serve signup for a customer who has decided to go ahead.
// New businesses always start in SHADOW MODE (drafts only, nothing sends) with an
// empty cabinet, so nothing can go out until the owner connects a mailbox, adds
// their own facts, reviews drafts, and turns shadow mode off themselves.

export const SignupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(10, "Use at least 10 characters for your password.").max(200),
  businessName: z.string().trim().min(2, "Enter your business name.").max(120),
  businessType: z.enum(Object.keys(STARTERS) as [string, ...string[]], { message: "Pick your type of business." }),
  timezone: z.enum(TIMEZONES.map(([tz]) => tz) as [string, ...string[]], { message: "Pick your time zone." }),
  mobile: z.string().trim().max(40).transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: "custom", message: "Enter a mobile number that can get texts, like (605) 555-0123." });
    return p ?? "";
  }),
  phone: z.string().trim().max(40).default(""),
  website: z.string().trim().max(200).default(""),
  accessCode: z.string().trim().max(100).default(""),
  agree: z.literal("on", { message: "Please confirm you understand how approvals work." }),
});

export type SignupInput = z.input<typeof SignupSchema>;
export type SignupResult = { ok: true; userId: string; tenantId: string } | { ok: false; errors: Record<string, string> };

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export async function signUp(raw: SignupInput): Promise<SignupResult> {
  const parsed = SignupSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, errors };
  }
  const v = parsed.data;
  // Don't create an account we can't verify.
  try {
    emailChannel();
    smsChannel();
  } catch (e) {
    if (e instanceof VerificationUnavailable) return { ok: false, errors: { form: "Sign-up is temporarily unavailable while we finish setting up verification. Please try again soon." } };
    throw e;
  }
  const code = env.signupCode();
  if (code && v.accessCode !== code) return { ok: false, errors: { accessCode: "That access code isn't right. Check the email you got from us." } };

  const profile = starterProfile({ businessName: v.businessName, ownerName: v.name, type: v.businessType, timezone: v.timezone, phone: v.phone, website: v.website });
  profile.approvers = [{ name: v.name, email: v.email }];
  const created = await systemDb.createAccount({
    email: v.email, name: v.name, passwordHash: await bcrypt.hash(v.password, 11), phone: v.mobile,
    businessName: v.businessName, slugBase: slugify(v.businessName), profile,
  });
  if (!created) return { ok: false, errors: { email: "An account with this email already exists. Sign in instead." } };
  await sendEmailCode(created.userId, { force: true });
  return { ok: true, userId: created.userId, tenantId: created.tenantId };
}
