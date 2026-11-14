import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getSql, closeSql } from "../src/lib/db/client";

export async function migrate(log = true) {
  const sql = getSql();
  const dir = path.join(process.cwd(), "db", "migrations");
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await sql`select 1 from schema_migrations where name = ${file}`;
    if (done.length) continue;
    const text = readFileSync(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    if (log) console.log(`applied ${file}`);
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .then(() => console.log("migrations up to date"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(closeSql);
}
