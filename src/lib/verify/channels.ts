import { env } from "@/lib/env";

// Delivery channels for verification codes.
//   Email: Resend (RESEND_API_KEY + NOTIFY_FROM_EMAIL)
//   Text:  Twilio Verify (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_VERIFY_SERVICE_SID).
//          Twilio generates, sends and checks the code; we never see it.
// On a developer machine without keys, a "dev" channel writes codes to the server log.
// On Vercel (production or preview) without keys, verification is unavailable: signup stops
// rather than letting unverified accounts in.

export class VerificationUnavailable extends Error {}

const deployed = () => !!process.env.VERCEL_ENV;

/** Codes "sent" through the dev channels (local runs and tests only). */
export const devOutbox: { kind: "email" | "phone"; to: string; code: string; link?: string }[] = [];

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function emailChannel(): { name: string; send(m: EmailMessage, devCode: string, devLink: string): Promise<void> } {
  const key = env.resendKey();
  const from = env.notifyFrom();
  if (key && from) {
    return {
      name: "resend",
      async send(m) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        });
        if (!res.ok) throw new Error(`Email could not be sent (${res.status}).`);
      },
    };
  }
  if (deployed()) throw new VerificationUnavailable("Email verification isn't set up yet (RESEND_API_KEY / NOTIFY_FROM_EMAIL).");
  return {
    name: "dev",
    async send(m, code, link) {
      devOutbox.push({ kind: "email", to: m.to, code, link });
      console.info(`[dev email] to ${m.to}: code ${code} · ${link}`);
    },
  };
}

export interface SmsVerifier {
  name: string;
  /** Twilio holds the code itself; the dev channel returns the code it generated so we can hash and store it. */
  start(to: string): Promise<{ localCode: string | null }>;
  /** Only used when the provider holds the code. */
  check?(to: string, code: string): Promise<boolean>;
}

export function smsChannel(): SmsVerifier {
  const sid = env.twilioSid();
  const token = env.twilioToken();
  const service = env.twilioVerifyService();
  if (sid && token && service) {
    const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
    const base = `https://verify.twilio.com/v2/Services/${service}`;
    return {
      name: "twilio",
      async start(to) {
        const res = await fetch(`${base}/Verifications`, {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: to, Channel: "sms" }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(res.status === 400 ? "That number can't receive texts. Check it and try again." : `Text could not be sent (${j.message ?? res.status}).`);
        }
        return { localCode: null };
      },
      async check(to, code) {
        const res = await fetch(`${base}/VerificationCheck`, {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: to, Code: code }),
        });
        if (res.status === 404) return false; // expired or already used
        if (!res.ok) throw new Error(`Code could not be checked (${res.status}).`);
        const j = (await res.json()) as { status?: string };
        return j.status === "approved";
      },
    };
  }
  if (deployed()) throw new VerificationUnavailable("Text verification isn't set up yet (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID).");
  return {
    name: "dev",
    async start(to) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      devOutbox.push({ kind: "phone", to, code });
      console.info(`[dev sms] to ${to}: code ${code}`);
      return { localCode: code };
    },
  };
}
