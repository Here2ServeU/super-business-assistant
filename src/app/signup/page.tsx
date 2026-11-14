import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { env } from "@/lib/env";
import { STARTERS, TIMEZONES } from "@/lib/starters";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Get started", description: "Set up your Super Business Assistant. Secure AI. Lower cost." };
export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const types = Object.entries(STARTERS).map(([k, s]) => [k, s.label] as [string, string]);
  return (
    <main className="flex min-h-screen flex-col">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <Logo />
          <div className="leading-tight">
            <p className="font-bold">Super Business Assistant</p>
            <p className="text-sm text-white/70">Secure AI. Lower cost.</p>
          </div>
          <Link href="/login" className="btn btn-secondary ml-auto border-white text-white hover:bg-white hover:text-navy">Sign in</Link>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-6">
          <p className="text-sm font-medium t2s-text">Welcome aboard</p>
          <h1 className="mt-1 max-w-2xl text-3xl font-bold sm:text-4xl">Let&apos;s set up your AI office manager.</h1>
          <p className="mt-3 max-w-2xl text-white/80">It takes about two minutes. You&apos;ll connect your inbox and add your facts right after.</p>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-5xl flex-1 gap-8 px-4 py-8 lg:grid-cols-[1fr_320px]">
        <section className="card p-6 sm:p-8" aria-label="Create your account">
          <SignupForm types={types} timezones={TIMEZONES} needsCode={!!env.signupCode()} defaultCode={code ?? ""} />
          <p className="mt-6 text-center text-sm text-muted">
            Already have an account? <Link href="/login" className="font-medium text-navy underline decoration-orange">Sign in</Link>
          </p>
        </section>

        <aside className="space-y-4" aria-label="What happens next">
          <div className="card p-5">
            <h2 className="font-bold">What happens next</h2>
            <ol className="mt-3 space-y-3 text-sm">
              {[
                ["Connect your inbox", "Gmail today. Microsoft 365 is coming soon."],
                ["Add your facts", "Services, prices, hours. The assistant only says what you put here."],
                ["Watch it work", "Review drafts in shadow mode for a week."],
                ["Turn on sending", "Then approve replies with one tap."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="t2s-gradient flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">{i + 1}</span>
                  <span><span className="block font-medium">{t}</span><span className="text-muted">{d}</span></span>
                </li>
              ))}
            </ol>
          </div>
          <div className="card border-l-4 border-orange p-5 text-sm">
            <p className="font-medium">Your data stays yours</p>
            <p className="mt-1 text-muted">Each business is kept separate. Your mailbox tokens are encrypted, and you can pause the assistant at any time.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
