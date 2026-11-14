import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/session";
import { hoursAgo } from "@/lib/scheduling";
import { TrayItem, type TrayDraft } from "./TrayItem";

export const metadata: Metadata = { title: "Approval tray" };

export default async function TrayPage() {
  const ctx = await requireContext();
  const settings = await ctx.db.settings();
  const tz = settings.profile.company.timezone;
  const rows = await ctx.db.listDrafts(["pending", "escalated", "approved", "edited"], 100);
  // approved/edited rows only appear when they were approved but never reached the mailbox (send failed).
  const unsent = [];
  for (const r of rows) {
    if (r.status === "approved" || r.status === "edited") {
      // Show only approvals that never reached the mailbox (no mailbox, or the send failed).
      const st = (await ctx.db.sendState(r.id))?.status;
      if (settings.shadowMode || (st && st !== "failed")) continue;
    }
    unsent.push(r);
  }
  const items: TrayDraft[] = unsent.map((r) => ({
    id: r.id,
    status: r.status,
    to: r.to_addr,
    subject: r.subject,
    body: r.final_body ?? r.body,
    model: r.model,
    escalationReason: r.escalation_reason,
    sources: r.sources.map((s) => ({ chunkId: s.chunkId, title: s.title, excerpt: s.excerpt })),
    slots: r.proposed_slots,
    original: {
      from: r.m_from, fromName: r.m_from_name, subject: r.m_subject, body: r.m_body, category: r.m_category, urgent: r.m_urgent,
      flags: r.m_flags, injection: r.m_injection,
      receivedAt: new Date(r.m_received_at).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    },
  }));
  const canDecide = ctx.role !== "viewer";
  const oneHourAgo = hoursAgo(1);
  const DECISIONS = ["sent", "shadow_would_send", "rejected", "escalated_by_human", "send_failed", "hold_conflict", "send_blocked_paused"];
  const recent = (await ctx.db.listAudit({ limit: 60 })).filter((a) => DECISIONS.includes(a.action) && new Date(a.created_at) > oneHourAgo).slice(0, 4);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Approval tray</h1>
        <p className="text-sm text-muted">
          {items.length ? `${items.length} repl${items.length === 1 ? "y is" : "ies are"} waiting. Nothing goes out until you approve it.` : "All clear. New drafts will show up here."}
        </p>
        {!canDecide && <p className="mt-2 text-sm text-danger">You have view-only access.</p>}
      </div>
      {recent.length > 0 && (
        <section className="card border-l-4 border-ok p-4" aria-label="Just handled">
          <h2 className="text-sm font-bold">Just handled</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {recent.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{({ sent: "Sent", shadow_would_send: "Shadow (not sent)", rejected: "Rejected", escalated_by_human: "Escalated", send_failed: "Send failed", hold_conflict: "Time taken", send_blocked_paused: "Blocked: paused" } as Record<string, string>)[a.action]}</span>
                <span className="text-muted"> · {a.detail || a.actor}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {items.map((d) => (
        <TrayItem key={d.id} d={d} canDecide={canDecide} shadow={settings.shadowMode} paused={settings.paused} />
      ))}
    </div>
  );
}
