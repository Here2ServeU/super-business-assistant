import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "@/lib/env";
import type { TenantDb } from "@/lib/dal";
import { notify } from "@/lib/notify";

// The model gateway. Two routes:
//   SMALL: sorting, simple drafts, summaries
//   LARGE: complex drafts
// Every call is checked against the tenant's monthly budget cap BEFORE it runs
// and recorded in usage_events (the meter) AFTER it runs.

export type Route = "small" | "large";

export class BudgetExceededError extends Error {
  constructor(public spent: number, public cap: number) {
    super(`Monthly AI budget reached ($${spent.toFixed(2)} of $${cap.toFixed(2)}).`);
  }
}

// USD per million tokens (input, cached input, output), from developers.openai.com/api/docs/pricing
// (Nov 2026, short-context rates). Keep in step with OpenAI's price list.
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-6.1-terra": { input: 1, cached: 0.05, output: 5 },
  "gpt-6.1-sol": { input: 2, cached: 0.1, output: 10 },
  "gpt-6-sol": { input: 2, cached: 0.2, output: 10 },
  "gpt-5.4": { input: 2.5, cached: 0.25, output: 15 },
  "gpt-6-astra": { input: 10, cached: 1, output: 50 },
};

/** Responses may report a dated snapshot id (e.g. "gpt-6-luna-2026-09-01"); price it as its base model. */
function priceFor(model: string) {
  if (PRICES[model]) return PRICES[model];
  const base = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => model.startsWith(`${k}-`));
  return base ? PRICES[base] : undefined;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0) {
  const p = priceFor(model);
  if (!p) return 0;
  const cached = Math.min(cachedTokens, inputTokens);
  return ((inputTokens - cached) * p.input + cached * p.cached + outputTokens * p.output) / 1_000_000;
}

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function budgetStatus(db: TenantDb) {
  const { profile } = await db.settings();
  const { usd, calls } = await db.spendSince(monthStart());
  const cap = profile.budget.monthlyCapUsd;
  return { spent: usd, calls, cap, ratio: cap > 0 ? usd / cap : 1, alertPercent: profile.budget.alertPercent };
}

export interface AiTask<T> {
  task: string; // e.g. "sort", "draft", "brief"
  route: Route;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Deterministic stand-in used when no provider key is set and in tests. Costs $0 but is still metered. */
  offline: () => T;
  maxTokens?: number;
}

let client: OpenAI | null = null;
function openai() {
  if (!client) client = new OpenAI({ apiKey: env.openaiKey() });
  return client;
}

export async function runAi<T>(db: TenantDb, t: AiTask<T>): Promise<{ output: T; model: string; costUsd: number }> {
  const before = await budgetStatus(db);
  if (before.spent >= before.cap) throw new BudgetExceededError(before.spent, before.cap);

  let output: T;
  let model: string;
  let inputTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;

  if (env.aiProvider() === "offline") {
    model = `offline-${t.route}`;
    output = t.offline();
  } else {
    model = t.route === "small" ? env.modelSmall() : env.modelLarge();
    // Structured output: the reply must match the zod schema (strict JSON schema on OpenAI's side).
    const res = await openai().responses.parse({
      model,
      instructions: t.system,
      input: t.user,
      max_output_tokens: t.maxTokens ?? 4000,
      store: false, // don't keep customer email on OpenAI's side for later retrieval
      text: { format: zodTextFormat(t.schema, t.task.replace(/[^a-z0-9_-]/gi, "_")) },
    });
    inputTokens = res.usage?.input_tokens ?? 0;
    cachedTokens = res.usage?.input_tokens_details?.cached_tokens ?? 0;
    outputTokens = res.usage?.output_tokens ?? 0;
    const refused = res.output.some((o) => o.type === "message" && o.content.some((c) => c.type === "refusal"));
    const parsed = refused || res.status !== "completed" ? null : (res.output_parsed as T | null);
    if (parsed == null) {
      // A refusal, an incomplete answer, or unparseable output never becomes a draft: use the safe deterministic path.
      await db.audit("assistant", "ai_fallback", null, `${t.task}: model output unusable (${refused ? "refusal" : res.status}); used safe fallback`);
      output = t.offline();
    } else {
      output = parsed;
    }
    model = res.model ?? model;
  }

  const cost = costUsd(model, inputTokens, outputTokens, cachedTokens);
  await db.insertUsage({ task: t.task, route: t.route, model, inputTokens, outputTokens, costUsd: cost });

  // 80% (configurable) alert, once per month.
  const after = before.spent + cost;
  const threshold = (before.cap * before.alertPercent) / 100;
  if (after >= threshold && (await db.auditCount("budget_alert", monthStart())) === 0) {
    await db.audit("meter", "budget_alert", null, `AI spend $${after.toFixed(4)} reached ${before.alertPercent}% of the $${before.cap} monthly cap`);
    await notify(db, { kind: "budget_alert", title: `AI budget at ${before.alertPercent}%`, body: `Spent $${after.toFixed(2)} of $${before.cap}.` });
  }
  if (after >= before.cap && (await db.auditCount("budget_cap_reached", monthStart())) === 0) {
    await db.audit("meter", "budget_cap_reached", null, `Drafting paused: $${after.toFixed(4)} of $${before.cap}`);
    await notify(db, { kind: "budget_cap", title: "AI budget cap reached", body: "Drafting is paused until next month or until the cap is raised." });
  }
  return { output, model, costUsd: cost };
}
