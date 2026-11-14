import { decrypt, encrypt } from "@/lib/crypto";
import type { TenantDb } from "@/lib/dal";
import { env } from "@/lib/env";
import { NORTH_STAR_INBOX } from "./demo-fixtures";
import type { ApprovalProof, BusyBlock, InboundMail, MailProvider, OutboundMail } from "./types";

/** Every provider re-checks the approval in the database before it sends anything. */
export async function verifyProof(db: TenantDb, proof: ApprovalProof) {
  if (!proof || proof.tenantId !== db.tenantId) throw new Error("send refused: approval belongs to another tenant");
  const approval = await db.approvalFor(proof.draftId);
  if (!approval || approval.id !== proof.approvalId) throw new Error("send refused: no recorded human approval for this draft");
  const draft = await db.draft(proof.draftId);
  if (!draft || !["approved", "edited"].includes(draft.status)) throw new Error(`send refused: draft is ${draft?.status ?? "missing"}`);
  const s = await db.settings();
  if (s.paused) throw new Error("send refused: assistant is paused");
  if (s.shadowMode) throw new Error("send refused: shadow mode is on");
}

// ---------------- Demo (fake mailbox for the demo tenant and tests) ----------------
export function demoProvider(db: TenantDb): MailProvider {
  return {
    name: "demo",
    async fetchNew() {
      return NORTH_STAR_INBOX;
    },
    async send(_mail, proof) {
      await verifyProof(db, proof);
      return { providerMessageId: `demo-${proof.draftId}` };
    },
    async busy() {
      return [];
    },
    async createHold(_h, proof) {
      await verifyProof(db, proof);
    },
  };
}

// ---------------- Gmail (OAuth, least privilege) ----------------
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly", // read
  "https://www.googleapis.com/auth/gmail.compose", // drafts
  "https://www.googleapis.com/auth/gmail.send", // send (only from the approve action)
  "https://www.googleapis.com/auth/calendar.events.owned", // holds on the owner's own calendars
  "https://www.googleapis.com/auth/calendar.freebusy", // check busy times
];

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
  scope?: string;
}

async function googleToken(db: TenantDb): Promise<string> {
  const conn = await db.connection("gmail");
  if (!conn?.token_ciphertext) throw new Error("Gmail is not connected");
  const tok = JSON.parse(decrypt(conn.token_ciphertext)) as GoogleTokens;
  if (tok.expires_at - 60_000 > Date.now()) return tok.access_token;
  if (!tok.refresh_token) throw new Error("Gmail token expired; reconnect Gmail in Settings");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId() ?? "",
      client_secret: env.googleClientSecret() ?? "",
      refresh_token: tok.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  const next: GoogleTokens = { ...tok, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
  await db.updateConnectionToken("gmail", encrypt(JSON.stringify(next)));
  return next.access_token;
}

export function encryptGoogleTokens(t: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }) {
  const tok: GoogleTokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000, scope: t.scope };
  return encrypt(JSON.stringify(tok));
}

async function gapi<T>(db: TenantDb, url: string, init: RequestInit = {}): Promise<T> {
  const token = await googleToken(db);
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Google API ${res.status} on ${new URL(url).pathname}`);
  return (await res.json()) as T;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}

function b64url(s: string) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function textOf(p: GmailPart): string {
  if (p.mimeType === "text/plain" && p.body?.data) return b64url(p.body.data);
  for (const c of p.parts ?? []) {
    const t = textOf(c);
    if (t) return t;
  }
  if (p.mimeType === "text/html" && p.body?.data) return b64url(p.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return "";
}

function parseFrom(v: string) {
  const m = v.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim(), addr: m[2].trim() } : { name: "", addr: v.trim() };
}

function encodeHeader(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
}

export function gmailProvider(db: TenantDb): MailProvider {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  return {
    name: "gmail",
    async fetchNew(max) {
      const list = await gapi<{ messages?: { id: string }[] }>(db, `${base}/messages?maxResults=${max}&q=${encodeURIComponent("in:inbox newer_than:2d -category:promotions -category:social")}`);
      const out: InboundMail[] = [];
      for (const { id } of list.messages ?? []) {
        const m = await gapi<{ id: string; threadId: string; internalDate: string; payload: GmailPart }>(db, `${base}/messages/${id}?format=full`);
        const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
        const from = parseFrom(h("from"));
        out.push({
          providerMessageId: m.id, threadId: m.threadId, fromAddr: from.addr, fromName: from.name, toAddr: h("to"),
          subject: h("subject"), body: textOf(m.payload), receivedAt: new Date(Number(m.internalDate)),
        });
      }
      return out;
    },
    async send(mail: OutboundMail, proof) {
      await verifyProof(db, proof);
      let refs = "";
      if (mail.inReplyToProviderId) {
        const orig = await gapi<{ payload: GmailPart }>(db, `${base}/messages/${mail.inReplyToProviderId}?format=metadata&metadataHeaders=Message-ID`);
        const mid = orig.payload.headers?.find((x) => x.name.toLowerCase() === "message-id")?.value;
        if (mid) refs = `In-Reply-To: ${mid}\r\nReferences: ${mid}\r\n`;
      }
      const raw = `To: ${mail.to}\r\nSubject: ${encodeHeader(mail.subject)}\r\n${refs}MIME-Version: 1.0\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${mail.body}`;
      const res = await gapi<{ id: string }>(db, `${base}/messages/send`, {
        method: "POST",
        body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url"), threadId: mail.threadId ?? undefined }),
      });
      return { providerMessageId: res.id };
    },
    async busy(from, to): Promise<BusyBlock[]> {
      const { profile } = await db.settings();
      const r = await gapi<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>(db, "https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: profile.company.timezone, items: [{ id: "primary" }] }),
      });
      return (r.calendars.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    },
    async createHold(h, proof) {
      await verifyProof(db, proof);
      await gapi(db, "https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        body: JSON.stringify({ summary: `HOLD: ${h.title}`, status: "tentative", start: { dateTime: h.start.toISOString() }, end: { dateTime: h.end.toISOString() } }),
      });
    },
  };
}

// ---------------- Microsoft 365 (stub behind the same interface) ----------------
export function microsoftProvider(): MailProvider {
  const notYet = () => {
    throw new Error("Microsoft 365 is not wired yet (stub). Use Gmail for now.");
  };
  return { name: "microsoft", fetchNew: notYet, send: notYet, busy: async () => [], createHold: notYet };
}

/** The mailbox for a tenant, or null when none is connected. */
export async function providerFor(db: TenantDb): Promise<MailProvider | null> {
  const conn = await db.connection();
  if (!conn) return null;
  if (conn.provider === "gmail") return gmailProvider(db);
  if (conn.provider === "microsoft") return microsoftProvider();
  return demoProvider(db);
}
