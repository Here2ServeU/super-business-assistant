import "dotenv/config";
import path from "node:path";
import bcrypt from "bcryptjs";
import { migrate } from "./migrate";
import { closeSql } from "../src/lib/db/client";
import { systemDb, tenantDb } from "../src/lib/dal";
import { onboard, readOnboarding } from "../src/lib/onboard";
import { demoProvider } from "../src/lib/mail/providers";
import { processTenant } from "../src/lib/pipeline";

// Seeds two tenants:
//   1. North Star Heating & Air (fake demo, reset on every seed, inbox processed)
//   2. Client Zero "Emmanuel" (created once in SHADOW MODE; never wiped by re-seeding)
// Logins come from env vars so no password or personal email is ever committed.

async function main() {
  if (!process.env.SEED_USE_AI) process.env.AI_PROVIDER = "offline"; // seeding never spends money unless asked
  await migrate();

  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  const demoEmail = process.env.SEED_DEMO_EMAIL ?? "demo@northstar.example";
  const demoPassword = process.env.SEED_DEMO_PASSWORD;

  const approvers = ownerEmail ? [{ name: "Emmanuel Naweji", email: ownerEmail }] : [];
  const ns = await onboard(readOnboarding(path.join("onboarding", "north-star.json")), { reset: true });
  const cz = await onboard(readOnboarding(path.join("onboarding", "client-zero.json")), { approverEmails: approvers });

  const nsDb = tenantDb(ns.tenantId);
  const run = await processTenant(nsDb, demoProvider(nsDb));
  const tally = run.results.reduce<Record<string, number>>((a, r) => ((a[r.outcome] = (a[r.outcome] ?? 0) + 1), a), {});
  console.log(`North Star: ${run.stored} messages ingested →`, tally);
  console.log(`Client Zero: ${cz.created ? "created in shadow mode" : "already exists (left untouched)"}`);

  if (ownerEmail && ownerPassword) {
    const uid = await systemDb.upsertUser({ email: ownerEmail, name: "Emmanuel Naweji", passwordHash: await bcrypt.hash(ownerPassword, 11) });
    await systemDb.addMember(cz.tenantId, uid, "owner");
    await systemDb.addMember(ns.tenantId, uid, "owner");
    console.log(`Owner login ready for ${ownerEmail} (both tenants).`);
  } else {
    console.log("SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD not set: owner login not created.");
  }
  if (demoPassword) {
    const uid = await systemDb.upsertUser({ email: demoEmail, name: "Demo Owner", passwordHash: await bcrypt.hash(demoPassword, 11) });
    await systemDb.addMember(ns.tenantId, uid, "owner");
    console.log(`Demo login ready for ${demoEmail} (North Star only).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeSql);
