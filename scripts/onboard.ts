import "dotenv/config";
import { closeSql } from "../src/lib/db/client";
import { onboard, readOnboarding } from "../src/lib/onboard";
import { migrate } from "./migrate";

// Usage: npm run onboard -- onboarding/your-business.json
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run onboard -- onboarding/<file>.json");
  await migrate(false);
  const r = await onboard(readOnboarding(file));
  console.log(r.created ? `Onboarded tenant ${r.tenantId}` : `Tenant already exists (${r.tenantId}); nothing changed.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closeSql);
