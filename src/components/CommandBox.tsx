"use client";

import { useActionState } from "react";
import { command } from "@/app/(app)/actions";

export function CommandBox() {
  const [state, action, pending] = useActionState(command, undefined);
  return (
    <form action={action} className="flex gap-2">
      <label className="sr-only" htmlFor="cmd">Command</label>
      <input id="cmd" name="cmd" className="input font-mono" placeholder="/pause or /resume" autoComplete="off" />
      <button className="btn btn-secondary" disabled={pending}>Run</button>
      {state?.message && <span className="self-center text-sm text-muted" role="status">{state.message}</span>}
    </form>
  );
}
