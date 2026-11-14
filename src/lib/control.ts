import type { TenantDb } from "@/lib/dal";
import { notify } from "@/lib/notify";

// /pause — a tenant-level kill switch. While paused: no intake, no sorting, no
// drafting, no sending, for THIS tenant only. Resume restarts cleanly: drafts
// still wait in the tray for a human; nothing queued during the pause is sent.

export async function pause(db: TenantDb, actor: string, reason = "") {
  await db.setPaused(true);
  await db.audit(actor, "paused", null, reason || "kill switch");
  await notify(db, { kind: "paused", title: "Assistant paused", body: `Paused by ${actor}. No sorting, drafting or sending until resumed.` });
}

export async function resume(db: TenantDb, actor: string) {
  await db.setPaused(false);
  await db.audit(actor, "resumed", null, "processing restarts on the next run; waiting drafts still need approval");
  await notify(db, { kind: "resumed", title: "Assistant resumed", body: `Resumed by ${actor}.` });
}

/** Text commands from the owner (e.g. typed "/pause" in the dashboard command box). */
export async function runCommand(db: TenantDb, actor: string, input: string) {
  const cmd = input.trim().toLowerCase();
  if (cmd === "/pause") {
    await pause(db, actor);
    return "Paused.";
  }
  if (cmd === "/resume") {
    await resume(db, actor);
    return "Resumed.";
  }
  return "Unknown command. Try /pause or /resume.";
}
