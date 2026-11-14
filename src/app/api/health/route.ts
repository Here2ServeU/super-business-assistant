import { systemDb } from "@/lib/dal";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database: { ok: boolean; vector?: boolean; error?: string } = { ok: false };
  try {
    const r = await systemDb.ping();
    database = { ok: r.ok === 1, vector: r.vector };
  } catch (e) {
    database = { ok: false, error: (e as Error).message.slice(0, 120) };
  }
  const body = {
    app: { ok: true, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" },
    database,
    ai: env.aiProvider(),
    ms: Date.now() - started,
  };
  return Response.json(body, { status: database.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
