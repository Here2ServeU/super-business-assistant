import type { TenantDb } from "@/lib/dal";
import { env } from "@/lib/env";

// Owner pings for the approval tray. Channels plug in behind one interface so
// SMS / WhatsApp / web push can be added later without touching the pipeline.
// NOTE: notifications never go through the tenant's mailbox; the only mailbox
// send path is the approve action (src/lib/approvals.ts).

export interface Notice {
  kind: "draft_waiting" | "urgent" | "budget_alert" | "budget_cap" | "brief_ready" | "paused" | "resumed";
  title: string;
  body: string;
  link?: string;
}

export interface NotifyChannel {
  name: string;
  send(db: TenantDb, notice: Notice, to: { name: string; email: string }[]): Promise<void>;
}

const inApp: NotifyChannel = {
  name: "in_app",
  async send(db, n) {
    await db.audit("notifier", "notify", null, `${n.kind}: ${n.title}`);
  },
};

const resendEmail: NotifyChannel = {
  name: "email",
  async send(db, n, to) {
    const key = env.resendKey();
    const from = env.notifyFrom();
    if (!key || !from || !to.length) return;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: to.map((t) => t.email),
        subject: `[Assistant] ${n.title}`,
        text: `${n.body}\n\n${n.link ? `${env.appUrl()}${n.link}` : env.appUrl()}`,
      }),
    });
    await db.audit("notifier", res.ok ? "notify_email" : "notify_email_failed", null, `${n.kind} to ${to.length} approver(s)`);
  },
};

export const channels: NotifyChannel[] = [inApp, resendEmail];

export async function notify(db: TenantDb, notice: Notice) {
  const { profile } = await db.settings();
  for (const c of channels) {
    try {
      await c.send(db, notice, profile.approvers);
    } catch (e) {
      await db.audit("notifier", "notify_failed", null, `${c.name}: ${(e as Error).message}`);
    }
  }
}
