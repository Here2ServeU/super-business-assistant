import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const src = files("src");

describe("Tenant isolation is enforced by one data-access layer", () => {
  it("only the DAL imports the raw database client", () => {
    const offenders = src.filter((f) => !f.startsWith(path.join("src", "lib", "dal")) && !f.endsWith(path.join("db", "client.ts")))
      .filter((f) => /from ["']@\/lib\/db\/client["']|lib\/db\/client/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("every tenant table query in tenantDb filters or writes tenant_id", () => {
    const dal = readFileSync("src/lib/dal/index.ts", "utf8");
    const tenantPart = dal.slice(dal.indexOf("export function tenantDb"), dal.indexOf("export type TenantDb"));
    const queries = tenantPart.match(/sql(?:<[^>]*>)?`[\s\S]*?`/g) ?? [];
    expect(queries.length).toBeGreaterThan(30);
    const missing = queries.filter((q) => /\b(from|update|into)\s+(messages|drafts|approvals|sent_messages|calendar_holds|kb_documents|kb_chunks|briefs|news_items|usage_events|audit_log|mail_connections|tenant_settings|tenant_members)\b/.test(q) && !/tenant_id/.test(q));
    expect(missing).toEqual([]);
  });
});
