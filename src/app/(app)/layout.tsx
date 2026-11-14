import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { Logo } from "@/components/Logo";
import { Nav } from "@/components/Nav";
import { hoursAgo } from "@/lib/scheduling";
import { logout } from "@/app/login/actions";
import { switchTenant, togglePause } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const settings = await ctx.db.settings();
  const counts = await ctx.db.counts(hoursAgo(24));
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={34} />
            <span className="hidden leading-tight sm:block">
              <span className="block text-sm font-bold">Super Business Assistant</span>
              <span className="block text-xs text-white/60">Secure AI. Lower cost.</span>
            </span>
          </Link>
          <form action={switchTenant} className="ml-auto">
            <label className="sr-only" htmlFor="tenant">Business</label>
            <select
              id="tenant"
              name="tenantId"
              defaultValue={ctx.tenant.id}
              className="max-w-[11rem] rounded-lg border border-white/20 bg-navy-2 px-2 py-2 text-sm text-white"
            >
              {ctx.tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button className="btn-quiet ml-1 rounded-lg px-2 py-2 text-xs text-white/70 hover:text-white">Switch</button>
          </form>
          <Link href="/tray" className="btn btn-primary hidden sm:inline-flex">
            Approve drafts{counts.waiting ? ` (${counts.waiting})` : ""}
          </Link>
          <form action={logout}>
            <button className="text-xs text-white/60 hover:text-white">Sign out</button>
          </form>
        </div>
      </header>
      {settings.paused && (
        <div className="bg-danger px-4 py-2 text-white">
          <form action={togglePause} className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 text-sm">
            <strong>Paused.</strong> No sorting, drafting or sending for {ctx.tenant.name}.
            <input type="hidden" name="pause" value="0" />
            {ctx.role !== "viewer" && <button className="ml-auto rounded-md bg-white px-3 py-1 font-medium text-danger">Resume</button>}
          </form>
        </div>
      )}
      {settings.shadowMode && (
        <div className="bg-navy-2 px-4 py-2 text-sm text-white">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <span className="h-2 w-2 rounded-full t2s-gradient" aria-hidden />
            <span><strong>Shadow mode.</strong> Drafts are created, but nothing is sent. Approvals are logged as &ldquo;would have sent.&rdquo;</span>
          </div>
        </div>
      )}
      <Nav waiting={counts.waiting} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="px-4 py-6 text-center text-xs text-muted">Nothing is ever sent without a human approving it.</footer>
    </div>
  );
}
