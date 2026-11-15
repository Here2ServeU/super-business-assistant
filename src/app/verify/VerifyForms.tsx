"use client";

import { useActionState, useState } from "react";
import type { VerifyState } from "./actions";

type Action = (prev: VerifyState | undefined, form: FormData) => Promise<VerifyState>;

function Messages({ s }: { s?: VerifyState }) {
  if (s?.error) return <p className="text-sm font-medium text-danger" role="alert">{s.error}</p>;
  if (s?.notice) return <p className="text-sm font-medium text-ok" role="status">{s.notice}</p>;
  return null;
}

export function CodeForm({ action, label, hint }: { action: Action; label: string; hint: string }) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="space-y-3">
      <label className="block space-y-1">
        <span className="label">{label}</span>
        <input
          className="input text-center font-mono text-2xl tracking-[0.5em]"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          placeholder="••••••"
          required
          autoFocus
        />
        <span className="block text-xs text-muted">{hint}</span>
      </label>
      <Messages s={state} />
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Checking…" : "Confirm"}</button>
    </form>
  );
}

export function ResendButton({ action, label }: { action: () => Promise<VerifyState>; label: string }) {
  const [state, run, pending] = useActionState(async () => action(), undefined);
  return (
    <form action={run} className="space-y-2">
      <button className="btn btn-quiet px-0 text-sm underline decoration-orange" disabled={pending}>{pending ? "Sending…" : label}</button>
      <Messages s={state} />
    </form>
  );
}

export function ChangeForm({ action, name, type, label, placeholder, button }: { action: Action; name: string; type: string; label: string; placeholder: string; button: string }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(action, undefined);
  if (!open) return <button type="button" className="btn btn-quiet px-0 text-sm underline decoration-orange" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form action={run} className="space-y-2">
      <label className="block space-y-1">
        <span className="label">{label}</span>
        <input className="input" name={name} type={type} placeholder={placeholder} required autoFocus autoComplete={type === "email" ? "email" : "tel"} />
      </label>
      <Messages s={state} />
      <div className="flex gap-2">
        <button className="btn btn-secondary" disabled={pending}>{pending ? "Sending…" : button}</button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
