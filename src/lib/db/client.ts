import postgres from "postgres";
import { env } from "@/lib/env";

// The raw connection. ONLY src/lib/dal/** and db scripts may import this file.
// A test (tests/architecture.test.ts) fails the build if anything else does.

declare global {
  var __sbaSql: postgres.Sql | undefined;
}

export function getSql(): postgres.Sql {
  if (!globalThis.__sbaSql) {
    globalThis.__sbaSql = postgres(env.databaseUrl(), {
      max: process.env.VERCEL ? 3 : 10,
      idle_timeout: 20,
      prepare: false, // works with pooled (pgbouncer) connection strings
      onnotice: () => {},
    });
  }
  return globalThis.__sbaSql;
}

export async function closeSql() {
  if (globalThis.__sbaSql) {
    await globalThis.__sbaSql.end({ timeout: 5 });
    globalThis.__sbaSql = undefined;
  }
}
