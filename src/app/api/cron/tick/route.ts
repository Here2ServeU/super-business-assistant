import { systemDb, tenantDb } from "@/lib/dal";
import { env } from "@/lib/env";
import { maybeRunBriefs } from "@/lib/briefs";
import { providerFor } from "@/lib/mail/providers";
import { processTenant } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron calls this (see vercel.json). For each tenant, independently:
// pull + process new mail, then make the daily brief (and Monday radar) when it's due.
// A failure or pause in one tenant never affects another.

export async function GET(req: Request) {
  const secret = env.cronSecret();
  if (!secret && process.env.VERCEL_ENV === "production") return new Response("CRON_SECRET not set", { status: 500 });
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });

  const report: Record<string, unknown> = {};
  for (const t of await systemDb.allTenantIds()) {
    const db = tenantDb(t.id);
    try {
      const s = await db.settings();
      if (s.paused) {
        report[t.slug] = "paused";
        continue;
      }
      const provider = await providerFor(db);
      const run = provider && provider.name !== "demo" ? await processTenant(db, provider) : { stored: 0, results: [] };
      const briefs = await maybeRunBriefs(db);
      report[t.slug] = { stored: run.stored, processed: run.results.length, briefs };
    } catch (e) {
      await db.audit("cron", "tick_failed", null, (e as Error).message).catch(() => {});
      report[t.slug] = `error: ${(e as Error).message}`;
    }
  }
  return Response.json({ ok: true, report });
}
