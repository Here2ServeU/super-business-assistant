import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { currentUser } from "@/lib/auth/session";
import { logout } from "@/app/login/actions";
import { maskPhone, verificationState } from "@/lib/verify";
import { resendEmail, resendPhone, submitEmailCode, submitPhoneCode, updateEmail, updatePhone } from "./actions";
import { ChangeForm, CodeForm, ResendButton } from "./VerifyForms";

export const metadata: Metadata = { title: "Confirm your details" };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ sent?: string; err?: string; confirmed?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect(sp.confirmed === "email" ? "/login?notice=email-confirmed" : "/login");
  const st = await verificationState(user.id);
  if (!st) redirect("/login");
  if (st.step === "done") redirect("/welcome");
  const devMode = !process.env.VERCEL_ENV;

  const steps = [
    { key: "email", label: "Email" },
    { key: "phone", label: "Mobile number" },
  ];
  const at = st.step === "email" ? 0 : 1;

  return (
    <main className="flex min-h-screen flex-col">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-4">
          <Logo />
          <div className="leading-tight">
            <p className="font-bold">Super Business Assistant</p>
            <p className="text-sm text-white/70">Secure AI. Lower cost.</p>
          </div>
          <form action={logout} className="ml-auto"><button className="text-xs text-white/60 hover:text-white">Sign out</button></form>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <ol className="mb-6 flex items-center gap-2" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < at ? "bg-ok text-white" : i === at ? "t2s-gradient text-white" : "border-2 border-line text-muted"}`}>
                {i < at ? "✓" : i + 1}
              </span>
              <span className={`text-sm ${i === at ? "font-bold" : "text-muted"}`}>{s.label}</span>
              {i < steps.length - 1 && <span className="mx-1 h-px flex-1 bg-line" aria-hidden />}
            </li>
          ))}
        </ol>

        <section className="card space-y-5 p-6">
          {sp.confirmed === "email" && st.step === "phone" && <p className="rounded-lg bg-warm px-3 py-2 text-sm font-medium text-ok">Email confirmed. ✓</p>}
          {sp.err && <p className="rounded-lg bg-warm px-3 py-2 text-sm font-medium text-danger" role="alert">{sp.err}</p>}

          {st.step === "email" ? (
            <>
              <div>
                <h1 className="text-xl font-bold">Check your email</h1>
                <p className="mt-1 text-sm text-muted">We sent a 6-digit code to <strong className="text-navy">{st.email}</strong>. You can also tap the button in that email.</p>
              </div>
              <CodeForm action={submitEmailCode} label="Code from the email" hint="The code works for 15 minutes." />
              <div className="space-y-2 border-t border-line pt-4">
                <ResendButton action={resendEmail} label="Send me a new code" />
                <ChangeForm action={updateEmail} name="email" type="email" label="Wrong email? Change it" placeholder="you@yourbusiness.com" button="Send code to this email" />
              </div>
            </>
          ) : (
            <>
              <div>
                <h1 className="text-xl font-bold">Check your phone</h1>
                <p className="mt-1 text-sm text-muted">We texted a code to your mobile number ending in <strong className="text-navy">{maskPhone(st.phone).replace("•••• ", "")}</strong>.</p>
              </div>
              <CodeForm action={submitPhoneCode} label="Code from the text" hint="The code works for 10 minutes." />
              <div className="space-y-2 border-t border-line pt-4">
                <ResendButton action={resendPhone} label="Text me a new code" />
                <ChangeForm action={updatePhone} name="phone" type="tel" label="Use a different number" placeholder="(605) 555-0123" button="Text this number" />
              </div>
            </>
          )}
        </section>

        {devMode && (
          <p className="mt-4 rounded-lg border border-dashed border-line p-3 text-xs text-muted">
            Developer mode: no email or text provider is set, so codes are printed in the server log.
          </p>
        )}
        <p className="mt-6 text-center text-xs text-muted">Why we ask: confirming your email and phone keeps your business account safe.</p>
      </div>
    </main>
  );
}
