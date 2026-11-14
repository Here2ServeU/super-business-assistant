import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { setShadowMode } from "../actions";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const settings = await ctx.db.settings();
  const conn = await ctx.db.connection();
  const members = await ctx.db.members();
  const owner = ctx.role === "owner";
  const googleReady = !!(env.googleClientId() && env.googleClientSecret());
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted">The client profile for {ctx.tenant.name}. {owner ? "" : "Only owners can change it."}</p>
      </div>
      {sp.connected && <p className="card border-l-4 border-ok p-3 text-sm">Mailbox connected.</p>}
      {sp.error && <p className="card border-l-4 border-danger p-3 text-sm">Couldn&apos;t connect: {sp.error}</p>}

      <section className="card space-y-3 p-5">
        <h2 className="font-bold">Mailbox</h2>
        <p className="text-sm">{conn ? <>Connected: <strong>{conn.provider === "demo" ? "Demo mailbox (fake data)" : conn.provider}</strong>{conn.account_email ? ` · ${conn.account_email}` : ""}</> : "No mailbox connected yet."}</p>
        {owner && (
          <div className="flex flex-wrap gap-2">
            {googleReady ? (
              <a className="btn btn-secondary" href="/api/mail/google/start">{conn?.provider === "gmail" ? "Reconnect Gmail" : "Connect Gmail"}</a>
            ) : (
              <span className="text-sm text-muted">Gmail connect needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment.</span>
            )}
            <button className="btn btn-secondary" disabled title="Coming soon">Connect Microsoft 365 (soon)</button>
          </div>
        )}
        <p className="text-xs text-muted">Permissions asked for: read mail, create drafts, send (only from Approve), check and hold calendar times. Tokens are encrypted at rest.</p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-bold">Shadow mode</h2>
        <p className="text-sm">
          {settings.shadowMode ? "On: drafts are created and shown, but sending is turned off everywhere. Approvals are logged as \"would have sent\"." : "Off: approved drafts are sent. Every send still needs a human approval."}
        </p>
        {owner && (
          <form action={setShadowMode}>
            <input type="hidden" name="on" value={settings.shadowMode ? "0" : "1"} />
            <button className="btn btn-secondary">{settings.shadowMode ? "Turn shadow mode off (start sending)" : "Turn shadow mode on"}</button>
          </form>
        )}
      </section>

      <ProfileForm p={settings.profile} editable={owner} />

      <section className="card p-5">
        <h2 className="mb-2 font-bold">People</h2>
        <ul className="space-y-1 text-sm">
          {members.map((m) => <li key={m.user_id}>{m.name || m.email} · <span className="chip">{m.role}</span></li>)}
        </ul>
      </section>
    </div>
  );
}
