"use client";

import { useActionState } from "react";
import { addKnowledge } from "../actions";

export function AddKnowledge() {
  const [state, action, pending] = useActionState(addKnowledge, undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="block space-y-1"><span className="label">Title</span><input name="title" className="input" placeholder="e.g. Prices 2027" /></label>
      <label className="block space-y-1"><span className="label">Facts the assistant may state</span><textarea name="content" className="input min-h-36" placeholder="Services, prices, hours, area, policies…" /></label>
      <label className="block space-y-1"><span className="label">…or upload a .txt / .md / .csv file</span><input type="file" name="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv" className="block text-sm" /></label>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Adding…" : "Add to cabinet"}</button>
      {state?.message && <p className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`} role="status">{state.message}</p>}
    </form>
  );
}
