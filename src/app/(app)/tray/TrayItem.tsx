"use client";

import { useActionState, useState } from "react";
import { decideDraft } from "../actions";

export interface TrayDraft {
  id: string;
  status: string;
  to: string;
  subject: string;
  body: string;
  model: string;
  escalationReason: string | null;
  sources: { chunkId: string; title: string; excerpt: string }[];
  slots: { label: string }[];
  original: { from: string; fromName: string; subject: string; body: string; receivedAt: string; category: string | null; urgent: boolean; flags: string[]; injection: boolean };
}

const FLAG_LABEL: Record<string, string> = { card: "card number removed", ssn: "SSN removed", password: "password removed", bank_account: "bank number removed" };

export function TrayItem({ d, canDecide, shadow, paused }: { d: TrayDraft; canDecide: boolean; shadow: boolean; paused: boolean }) {
  const [state, action, pending] = useActionState(decideDraft, undefined);
  const [body, setBody] = useState(d.body);
  const edited = body.trim() !== d.body.trim();
  const done = state?.ok;

  return (
    <article className={`card overflow-hidden ${d.original.urgent ? "ring-2 ring-orange" : ""}`} aria-labelledby={`s-${d.id}`}>
      <header className="border-b border-line p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {d.original.urgent && <span className="chip border-orange bg-orange text-white">Urgent</span>}
          {d.status === "escalated" && <span className="chip border-navy bg-navy text-white">Needs you</span>}
          {d.status === "approved" && <span className="chip">Approved, not sent yet</span>}
          {d.original.category && <span className="chip">{d.original.category}</span>}
          {d.original.injection && <span className="chip text-danger">Suspicious instructions</span>}
          {d.original.flags.map((f) => <span key={f} className="chip">🔒 {FLAG_LABEL[f] ?? f}</span>)}
        </div>
        <h2 id={`s-${d.id}`} className="mt-2 font-bold leading-snug">{d.original.subject || "(no subject)"}</h2>
        <p className="text-sm text-muted">
          From {d.original.fromName ? `${d.original.fromName} <${d.original.from}>` : d.original.from} · {d.original.receivedAt}
        </p>
        {d.escalationReason && <p className="mt-2 rounded-lg bg-warm px-3 py-2 text-sm"><strong>Why it needs you:</strong> {d.escalationReason}</p>}
      </header>

      <details className="border-b border-line px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Original email</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-navy/90">{d.original.body}</pre>
      </details>

      <form action={action} className="space-y-3 p-4">
        <input type="hidden" name="draftId" value={d.id} />
        <label className="block">
          <span className="label">Reply to {d.to}{edited ? " · edited" : ""}</span>
          <textarea
            name="body"
            className="input mt-1 min-h-48 font-sans leading-relaxed"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!canDecide || done}
            rows={Math.min(18, body.split("\n").length + 2)}
          />
        </label>

        {(d.sources.length > 0 || d.slots.length > 0) && (
          <div className="rounded-lg bg-warm p-3 text-sm">
            {d.sources.length > 0 && (
              <>
                <p className="font-medium">From your cabinet</p>
                <ul className="mt-1 space-y-1">
                  {d.sources.map((s) => (
                    <li key={s.chunkId}><span className="font-medium">{s.title}:</span> <span className="text-muted">{s.excerpt}{s.excerpt.length >= 280 ? "…" : ""}</span></li>
                  ))}
                </ul>
              </>
            )}
            {d.slots.length > 0 && <p className="mt-2"><span className="font-medium">Times offered (held on approval):</span> {d.slots.map((s) => s.label).join(" · ")}</p>}
            <p className="mt-2 text-xs text-muted">Drafted by {d.model}</p>
          </div>
        )}

        {canDecide && !done && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              name="kind"
              value={edited ? "edit_approve" : "approve"}
              className="btn btn-primary col-span-2 sm:col-auto"
              disabled={pending || paused}
              title={paused ? "Resume the assistant to approve" : undefined}
            >
              {pending ? "Working…" : `${edited ? "Approve edited reply" : "Approve"}${shadow ? " (shadow: won't send)" : " & send"}`}
            </button>
            {d.status !== "escalated" && <button name="kind" value="escalate" className="btn btn-secondary" disabled={pending}>Escalate</button>}
            <button name="kind" value="reject" className="btn btn-quiet" disabled={pending}>Reject</button>
            {edited && <button type="button" className="btn btn-quiet" onClick={() => setBody(d.body)}>Undo edits</button>}
          </div>
        )}
        {state?.message && (
          <p className={`text-sm font-medium ${state.ok ? "text-ok" : "text-danger"}`} role="status">{state.message}</p>
        )}
      </form>
    </article>
  );
}
