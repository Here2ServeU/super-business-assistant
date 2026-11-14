"use client";

import { useActionState, useEffect, useRef } from "react";
import { signup } from "./actions";

interface Props {
  types: [string, string][];
  timezones: readonly (readonly [string, string])[];
  needsCode: boolean;
  defaultCode: string;
}

function guessTz(options: readonly (readonly [string, string])[]) {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return options.some(([v]) => v === tz) ? tz : "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

export function SignupForm({ types, timezones, needsCode, defaultCode }: Props) {
  const [state, action, pending] = useActionState(signup, undefined);
  const tzRef = useRef<HTMLSelectElement>(null);
  const v = state?.values ?? {};
  // Pre-select the visitor's own time zone after load (the server can't know it).
  useEffect(() => {
    if (tzRef.current && !v.timezone) tzRef.current.value = guessTz(timezones);
  }, [timezones, v.timezone]);
  const e = state?.errors ?? {};
  const err = (k: string) => e[k] && <span className="block text-sm text-danger" id={`${k}-err`}>{e[k]}</span>;
  const aria = (k: string) => (e[k] ? { "aria-invalid": true, "aria-describedby": `${k}-err` } : {});

  return (
    <form action={action} className="space-y-6" noValidate>
      <fieldset className="space-y-4">
        <legend className="text-lg font-bold">About you</legend>
        <label className="block space-y-1">
          <span className="label">Your name</span>
          <input className="input" name="name" autoComplete="name" defaultValue={v.name} required {...aria("name")} />
          {err("name")}
        </label>
        <label className="block space-y-1">
          <span className="label">Email</span>
          <input className="input" type="email" name="email" autoComplete="email" defaultValue={v.email} required {...aria("email")} />
          {err("email")}
        </label>
        <label className="block space-y-1">
          <span className="label">Password</span>
          <input className="input" type="password" name="password" autoComplete="new-password" minLength={10} required {...aria("password")} />
          <span className="block text-xs text-muted">At least 10 characters.</span>
          {err("password")}
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-bold">About your business</legend>
        <label className="block space-y-1">
          <span className="label">Business name</span>
          <input className="input" name="businessName" autoComplete="organization" defaultValue={v.businessName} required {...aria("businessName")} />
          {err("businessName")}
        </label>
        <label className="block space-y-1">
          <span className="label">Type of business</span>
          <select className="input" name="businessType" defaultValue={v.businessType ?? ""} required {...aria("businessType")}>
            <option value="" disabled>Choose one…</option>
            {types.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <span className="block text-xs text-muted">We use this to set up sorting and safety rules. You can change everything later.</span>
          {err("businessType")}
        </label>
        <label className="block space-y-1">
          <span className="label">Time zone</span>
          <select ref={tzRef} className="input" name="timezone" defaultValue={v.timezone ?? "America/Chicago"} {...aria("timezone")}>
            {timezones.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {err("timezone")}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="label">Business phone <span className="font-normal">(optional)</span></span>
            <input className="input" type="tel" name="phone" autoComplete="tel" defaultValue={v.phone} />
          </label>
          <label className="block space-y-1">
            <span className="label">Website <span className="font-normal">(optional)</span></span>
            <input className="input" name="website" autoComplete="url" placeholder="yourbusiness.com" defaultValue={v.website} />
          </label>
        </div>
        {needsCode && (
          <label className="block space-y-1">
            <span className="label">Access code</span>
            <input className="input" name="accessCode" defaultValue={v.accessCode ?? defaultCode} autoComplete="off" required {...aria("accessCode")} />
            <span className="block text-xs text-muted">It&apos;s in the email we sent after your free AI check.</span>
            {err("accessCode")}
          </label>
        )}
      </fieldset>

      <div className="rounded-xl bg-warm p-4 text-sm">
        <p className="font-medium">How it works from day one</p>
        <ul className="mt-2 space-y-1.5">
          <li>✓ You start in <strong>shadow mode</strong>: the assistant drafts replies, but sends nothing.</li>
          <li>✓ When you&apos;re ready to send, <strong>every reply still waits for your approval</strong>.</li>
          <li>✓ Card numbers, SSNs and passwords are removed before anything is saved.</li>
          <li>✓ You can pause everything at any time with <code>/pause</code>.</li>
        </ul>
        <label className="mt-3 flex items-start gap-2">
          <input type="checkbox" name="agree" className="mt-1" {...aria("agree")} />
          <span>I understand: nothing is sent without my approval.</span>
        </label>
        {err("agree")}
      </div>

      {e.form && <p className="text-sm text-danger" role="alert">{e.form}</p>}
      <button className="btn btn-primary w-full text-base" disabled={pending}>{pending ? "Setting up your assistant…" : "Create my account"}</button>
    </form>
  );
}
