import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
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

// USD per million tokens. Keep in step with the provider's price list.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number) {
  const p = PRICES[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
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

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey() });
  return client;
}

export async function runAi<T>(db: TenantDb, t: AiTask<T>): Promise<{ output: T; model: string; costUsd: number }> {
  const before = await budgetStatus(db);
  if (before.spent >= before.cap) throw new BudgetExceededError(before.spent, before.cap);

  let output: T;
  let model: string;
  let inputTokens = 0;
  let outputTokens = 0;

  if (env.aiProvider() === "offline") {
    model = `offline-${t.route}`;
    output = t.offline();
  } else {
    model = t.route === "small" ? env.modelSmall() : env.modelLarge();
    const fallbacks = model.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
    const res = await anthropic().beta.messages.parse({
      model,
      max_tokens: t.maxTokens ?? 4000,
      system: t.system,
      messages: [{ role: "user", content: t.user }],
      output_config: { effort: t.route === "small" ? "low" : "medium", format: betaZodOutputFormat(t.schema) },
      ...fallbacks,
    } as Parameters<ReturnType<typeof anthropic>["beta"]["messages"]["parse"]>[0]);
    inputTokens = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    outputTokens = res.usage.output_tokens;
    const parsed = res.stop_reason === "refusal" ? null : (res.parsed_output as T | null);
    if (parsed == null) {
      // A refusal or unparseable answer never becomes a draft; fall back to the safe deterministic path.
      await db.audit("assistant", "ai_fallback", null, `${t.task}: model output unusable (${res.stop_reason}); used safe fallback`);
      output = t.offline();
    } else {
      output = parsed;
    }
    model = res.model ?? model;
  }

  const cost = costUsd(model, inputTokens, outputTokens);
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
