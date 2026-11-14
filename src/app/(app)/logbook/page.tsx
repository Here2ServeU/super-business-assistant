import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Logbook" };

export default async function LogbookPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await requireContext();
  const { profile } = await ctx.db.settings();
  const rows = await ctx.db.listAudit({ q: q?.trim() || undefined, limit: 300 });
  const tz = profile.company.timezone;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Logbook</h1>
        <p className="text-sm text-muted">Every intake, guard action, sort, draft, approval, edit, escalation, send, pause and resume.</p>
      </div>
      <form className="flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">Search the logbook</label>
        <input id="q" name="q" defaultValue={q} className="input" placeholder="Search: sent, approved, guard, an email address…" />
        <button className="btn btn-secondary">Search</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr><th className="p-3 font-medium">When</th><th className="p-3 font-medium">Who</th><th className="p-3 font-medium">Action</th><th className="p-3 font-medium">Detail</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="whitespace-nowrap p-3 text-muted">{new Date(r.created_at).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
                <td className="p-3">{r.actor}</td>
                <td className="p-3"><span className="chip font-mono">{r.action}</span></td>
                <td className="p-3 break-words">{r.detail}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="p-4 text-muted">Nothing found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
