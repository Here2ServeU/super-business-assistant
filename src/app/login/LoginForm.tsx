"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1">
        <span className="label">Email</span>
        <input className="input" type="email" name="email" autoComplete="email" required />
      </label>
      <label className="block space-y-1">
        <span className="label">Password</span>
        <input className="input" type="password" name="password" autoComplete="current-password" required />
      </label>
      {state?.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
