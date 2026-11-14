import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { budgetStatus } from "@/lib/ai/gateway";
import { Meter } from "@/components/Meter";
import { CommandBox } from "@/components/CommandBox";
import { localDate, zoned } from "@/lib/scheduling";
import { syncNow, togglePause } from "./actions";

export default async function Dashboard() {
  const ctx = await requireContext();
  const settings = await ctx.db.settings();
  const tz = settings.profile.company.timezone;
  const [y, m, d] = localDate(tz).split("-").map(Number);
  const today = zoned(tz, y, m, d, 0, 0);
  const counts = await ctx.db.counts(today);
  const budget = await budgetStatus(ctx.db);
  const conn = await ctx.db.connection();
  const canAct = ctx.role !== "viewer";

  const stats = [
    { label: "Received today", value: counts.received },
    { label: "Drafted today", value: counts.drafted },
    { label: "Waiting for you", value: counts.waiting, href: "/tray", accent: true },
    { label: "Sent today", value: counts.sent },
  ];
  const pillars = [
    { name: "Front desk", detail: conn ? `${conn.provider === "demo" ? "Demo mailbox" : conn.provider === "gmail" ? "Gmail" : "Microsoft 365"}${conn.last_synced_at ? " · synced " + new Date(conn.last_synced_at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : ""}` : "No mailbox connected", ok: !!conn },
    { name: "Guard", detail: `Masks ${settings.profile.guardList.length ? "cards, SSNs, passwords, bank numbers" : "nothing (check settings)"}`, ok: true },
    { name: "Cabinet", detail: "Drafts use only your knowledge base", ok: true },
    { name: "Approval", detail: settings.shadowMode ? "Shadow mode: sending disabled" : "Every send needs a human", ok: true },
    { name: "Meter", detail: `${budget.calls} AI calls this month`, ok: budget.spent < budget.cap },
    { name: "Kill switch", detail: settings.paused ? "PAUSED" : "Running", ok: !settings.paused },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{ctx.tenant.name}</h1>
          <p className="text-sm text-muted">Today, {new Date().toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        {canAct && (
          <div className="flex gap-2">
            <form action={syncNow}><button className="btn btn-secondary">Check inbox now</button></form>
            <form action={togglePause}>
              <input type="hidden" name="pause" value={settings.paused ? "0" : "1"} />
              <button className={`btn ${settings.paused ? "btn-primary" : "btn-secondary"}`}>{settings.paused ? "Resume" : "Pause"}</button>
            </form>
          </div>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Today">
        {stats.map((s) => {
          const inner = (
            <div className={`card h-full p-4 ${s.accent && s.value ? "border-l-4 border-orange" : ""}`}>
              <p className="text-sm text-muted">{s.label}</p>
              <p className="mt-1 text-3xl font-bold">{s.value}</p>
            </div>
          );
          return s.href ? <Link key={s.label} href={s.href}>{inner}</Link> : <div key={s.label}>{inner}</div>;
        })}
      </section>

      <section className="card p-5" aria-label="Budget">
        <h2 className="mb-3 font-bold">AI budget</h2>
        <Meter spent={budget.spent} cap={budget.cap} alertPercent={budget.alertPercent} />
      </section>

      <section aria-label="Pillars">
        <h2 className="mb-3 font-bold">How the assistant is doing</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p) => (
            <li key={p.name} className="card flex items-start gap-3 p-4">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${p.ok ? "bg-ok" : "bg-danger"}`} aria-hidden />
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-sm text-muted">{p.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {canAct && (
        <section className="card p-5" aria-label="Commands">
          <h2 className="mb-1 font-bold">Commands</h2>
          <p className="mb-3 text-sm text-muted">Type <code>/pause</code> to stop everything for this business right away. <code>/resume</code> starts it again.</p>
          <CommandBox />
        </section>
      )}
    </div>
  );
}
