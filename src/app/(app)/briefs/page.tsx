import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/session";
import type { BriefContent } from "@/lib/briefs";
import { makeBriefNow } from "../actions";

export const metadata: Metadata = { title: "Briefs" };

export default async function BriefsPage() {
  const ctx = await requireContext();
  const { profile } = await ctx.db.settings();
  const briefs = (await ctx.db.listBriefs(60)).filter((b) => b.kind === "daily");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Briefs</h1>
          <p className="text-sm text-muted">Daily at {profile.brief.time} ({profile.company.timezone}). Growth radar on {days[profile.brief.radarWeekday]}s.</p>
        </div>
        {ctx.role !== "viewer" && <form action={makeBriefNow}><button className="btn btn-secondary">Make today&apos;s brief now</button></form>}
      </div>
      {briefs.length === 0 && <p className="card p-4 text-sm text-muted">No briefs yet. The first one arrives at {profile.brief.time}.</p>}
      {briefs.map((b) => {
        const c = b.content as BriefContent;
        return (
          <article key={b.id} className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{new Date(`${b.brief_date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h2>
              {c.radar && <span className="chip">+ Growth radar</span>}
            </div>
            <p className="mt-2">{c.summary}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-5">
              {[["New", c.counts.received], ["Drafted", c.counts.drafted], ["Waiting", c.counts.waiting], ["Sent", c.counts.sent], ["Urgent", c.counts.urgent]].map(([k, v]) => (
                <div key={k as string} className="rounded-lg bg-warm p-2"><dt className="text-muted">{k}</dt><dd className="text-lg font-bold">{v}</dd></div>
              ))}
            </dl>
            {c.news.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-bold">In your field</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {c.news.map((n) => <li key={n.url || n.title}>{n.url ? <a className="underline decoration-orange" href={n.url} target="_blank" rel="noreferrer noopener">{n.title}</a> : n.title}</li>)}
                </ul>
              </div>
            )}
            {c.radar && (
              <div className="mt-4">
                <h3 className="text-sm font-bold">Growth radar</h3>
                <p className="text-sm text-muted">{c.radar.changes.length ? `Changed this week: ${c.radar.changes.map((x) => x.name).join(", ")}` : "No competitor website changes spotted."}</p>
              </div>
            )}
            <div className="mt-4 border-l-4 border-orange pl-3">
              <h3 className="text-sm font-bold">Next steps</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{c.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
          </article>
        );
      })}
    </div>
  );
}
