import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Inbox" };

const STATUS: Record<string, string> = {
  new: "New", sorted: "Sorted", drafted: "Draft waiting", escalated: "Needs you", no_reply: "No reply needed", waiting_budget: "Waiting: budget cap", done: "Replied",
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const ctx = await requireContext();
  const { profile } = await ctx.db.settings();
  const msgs = await ctx.db.listMessages({ category: c, limit: 200 });
  const tz = profile.company.timezone;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="text-sm text-muted">Sorted mail. Sensitive numbers are removed before anything is saved.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Link href="/inbox" className={`chip shrink-0 ${!c ? "border-navy bg-navy text-white" : ""}`}>All</Link>
        {profile.categories.map((cat) => (
          <Link key={cat.name} href={`/inbox?c=${encodeURIComponent(cat.name)}`} className={`chip shrink-0 ${c === cat.name ? "border-navy bg-navy text-white" : ""}`}>{cat.name}</Link>
        ))}
      </div>
      <ul className="card divide-y divide-line">
        {msgs.length === 0 && <li className="p-4 text-sm text-muted">No mail yet.</li>}
        {msgs.map((m) => (
          <li key={m.id} className="p-4">
            <details>
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center gap-1.5">
                  {m.urgent && <span className="chip border-orange bg-orange text-white">Urgent</span>}
                  {m.category && <span className="chip">{m.category}</span>}
                  <span className="chip">{STATUS[m.status] ?? m.status}</span>
                  {m.masked_flags.length > 0 && <span className="chip">🔒 {m.masked_flags.join(", ")} removed</span>}
                  {m.injection_suspected && <span className="chip text-danger">Suspicious instructions</span>}
                  {m.language !== "en" && <span className="chip">{m.language.toUpperCase()}</span>}
                  <span className="ml-auto text-xs text-muted">{new Date(m.received_at).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
                <p className="mt-1 font-medium">{m.subject || "(no subject)"}</p>
                <p className="text-sm text-muted">{m.from_name || m.from_addr}</p>
              </summary>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-warm p-3 font-sans text-sm">{m.body}</pre>
              {m.escalation_reason && <p className="mt-2 text-sm"><strong>Escalated:</strong> {m.escalation_reason}</p>}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
