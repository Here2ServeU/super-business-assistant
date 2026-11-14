import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const ctx = await requireContext();
  const settings = await ctx.db.settings();
  const conn = await ctx.db.connection();
  const docs = await ctx.db.listDocuments();
  const steps = [
    { done: true, title: "Create your account", body: `${ctx.tenant.name} is set up in shadow mode.`, href: null },
    { done: !!conn, title: "Connect your inbox", body: "Go to Settings → Connect Gmail. We ask only to read, draft, send (after you approve) and check your calendar.", href: "/settings" },
    { done: docs.length > 0, title: "Add your facts to the Cabinet", body: "Services, prices, hours, area, policies. Until you do, every draft says “let me check” and comes to you.", href: "/cabinet" },
    { done: false, title: "Check your settings", body: "Hours, categories, words that always come to you, your signature and your monthly AI budget.", href: "/settings" },
    { done: !settings.shadowMode, title: "Watch the tray, then turn on sending", body: "Review drafts for about a week. When they look right, turn shadow mode off in Settings. Every send still needs your approval.", href: "/tray" },
  ];
  const next = steps.findIndex((s) => !s.done);
  const first = ctx.user.name.split(/\s+/)[0];
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="card overflow-hidden">
        <div className="t2s-gradient h-1.5" aria-hidden />
        <div className="p-6">
          <h1 className="text-2xl font-bold">Welcome{first ? `, ${first}` : ""}!</h1>
          <p className="mt-1 text-muted">Your assistant is ready. Here&apos;s how to get it working for {ctx.tenant.name}.</p>
        </div>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="card flex gap-4 p-5">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.done ? "bg-ok text-white" : "border-2 border-navy text-navy"}`} aria-hidden>
              {s.done ? "✓" : i + 1}
            </span>
            <div className="flex-1">
              <h2 className="font-bold">{s.title}{s.done && <span className="sr-only"> (done)</span>}</h2>
              <p className="text-sm text-muted">{s.body}</p>
              {s.href && !s.done && <Link href={s.href} className={`btn mt-3 ${i === next ? "btn-primary" : "btn-secondary"}`}>{i === next ? "Start here" : "Go"}</Link>}
            </div>
          </li>
        ))}
      </ol>
      <p className="text-center text-sm text-muted"><Link href="/" className="underline decoration-orange">Skip to the dashboard</Link></p>
    </div>
  );
}
