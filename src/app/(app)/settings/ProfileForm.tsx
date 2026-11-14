"use client";

import { useActionState } from "react";
import type { Profile } from "@/lib/settings";
import { saveSettings } from "../actions";

const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const GUARDS = [["card", "Card numbers"], ["ssn", "Social Security numbers"], ["password", "Passwords and PINs"], ["bank_account", "Bank account numbers"]] as const;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="card space-y-4 p-5">
      <legend className="sr-only">{title}</legend>
      <h2 className="font-bold">{title}</h2>
      {children}
    </fieldset>
  );
}

export function ProfileForm({ p, editable }: { p: Profile; editable: boolean }) {
  const [state, action, pending] = useActionState(saveSettings, undefined);
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={!editable || pending} className="space-y-4">
        <Section title="Company basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name"><input name="name" className="input" defaultValue={p.company.name} required /></Field>
            <Field label="Owner's first name"><input name="ownerName" className="input" defaultValue={p.company.ownerName} /></Field>
            <Field label="Time zone"><input name="timezone" className="input" defaultValue={p.company.timezone} /></Field>
            <Field label="Phone"><input name="phone" className="input" defaultValue={p.company.phone} /></Field>
            <Field label="Website"><input name="website" className="input" defaultValue={p.company.website} /></Field>
            <Field label="Voice"><input name="voice" className="input" defaultValue={p.company.voice} /></Field>
          </div>
          <Field label="Signature" hint="Added to the end of every draft."><textarea name="signature" className="input min-h-28" defaultValue={p.signature} /></Field>
        </Section>

        <Section title="Hours">
          <div className="grid gap-2">
            {DAYS.map(([k, label]) => {
              const h = p.hours[k];
              return (
                <div key={k} className="grid grid-cols-[3rem_1fr_1fr_auto] items-center gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  <input aria-label={`${label} open`} type="time" name={`${k}_open`} className="input" defaultValue={h?.open ?? ""} />
                  <input aria-label={`${label} close`} type="time" name={`${k}_close`} className="input" defaultValue={h?.close ?? ""} />
                  <label className="flex items-center gap-1 text-sm"><input type="checkbox" name={`${k}_closed`} defaultChecked={!h} /> Closed</label>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Sorting">
          <Field label="Categories" hint="One per line: Name | keyword, keyword | reply yes/no | offer times yes/no">
            <textarea name="categories" className="input min-h-44 font-mono text-sm" defaultValue={p.categories.map((c) => `${c.name} | ${c.keywords.join(", ")} | ${c.reply ? "yes" : "no"} | ${c.scheduling ? "yes" : "no"}`).join("\n")} />
          </Field>
          <Field label="Urgent words" hint="One per line. These get flagged and pinged right away.">
            <textarea name="urgentKeywords" className="input min-h-24" defaultValue={p.urgentKeywords.join("\n")} />
          </Field>
        </Section>

        <Section title="Guard and escalation">
          <div>
            <span className="label">Always remove before saving or sending to AI</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {GUARDS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`guard_${k}`} defaultChecked={p.guardList.includes(k)} /> {label}</label>
              ))}
            </div>
          </div>
          <Field label="Always escalate to a person" hint="One word or phrase per line. Matching emails get a holding reply and go to you.">
            <textarea name="alwaysEscalate" className="input min-h-32" defaultValue={p.alwaysEscalate.join("\n")} />
          </Field>
          <Field label="Approvers" hint="One per line: Name | email. They get pinged when drafts are waiting.">
            <textarea name="approvers" className="input min-h-20" defaultValue={p.approvers.map((a) => `${a.name} | ${a.email}`).join("\n")} />
          </Field>
        </Section>

        <Section title="Budget and briefs">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly AI budget cap (USD)" hint="Drafting pauses at the cap."><input name="cap" type="number" min="1" step="1" className="input" defaultValue={p.budget.monthlyCapUsd} /></Field>
            <Field label="Alert at (%)"><input name="alertPercent" type="number" min="1" max="99" className="input" defaultValue={p.budget.alertPercent} /></Field>
            <Field label="Daily brief time"><input name="briefTime" type="time" className="input" defaultValue={p.brief.time} /></Field>
            <Field label="Growth radar day">
              <select name="radarWeekday" className="input" defaultValue={p.brief.radarWeekday}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </Field>
          </div>
          <Field label="News keywords" hint="One per line."><textarea name="newsKeywords" className="input min-h-24" defaultValue={p.news.keywords.join("\n")} /></Field>
          <Field label="Competitors" hint="One per line: Name | https://website"><textarea name="competitors" className="input min-h-20" defaultValue={p.news.competitors.map((c) => `${c.name} | ${c.url}`).join("\n")} /></Field>
        </Section>
      </fieldset>
      {editable && (
        <div className="sticky bottom-0 flex items-center gap-3 bg-warm/95 py-3 backdrop-blur">
          <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
          {state?.message && <span className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`} role="status">{state.message}</span>}
        </div>
      )}
    </form>
  );
}
