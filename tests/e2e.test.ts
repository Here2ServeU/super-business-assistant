import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decide } from "@/lib/approvals";
import { maybeRunBriefs } from "@/lib/briefs";
import { pause, resume } from "@/lib/control";
import { closeSql, getSql } from "@/lib/db/client";
import { tenantDb } from "@/lib/dal";
import { NORTH_STAR_INBOX } from "@/lib/mail/demo-fixtures";
import { processTenant, storeInbound } from "@/lib/pipeline";
import { draftFor, freshNorthStar, otherTenant, sentCount, user } from "./support/fixtures";

// End-to-end tests against the North Star demo tenant: real Postgres, real
// pipeline, the free offline model, and a recording demo mailbox.

let ns: Awaited<ReturnType<typeof freshNorthStar>>;

beforeEach(async () => {
  ns = await freshNorthStar();
});
afterAll(closeSql);

const approve = (draftId: string, who = ns.owner, provider = ns.provider, db = ns.db) => decide(db, provider, who, draftId, { kind: "approve" });

describe("Front desk: intake, guard, sort", () => {
  it("ingests all 15 seeded messages and sorts each one", async () => {
    expect(ns.run.stored).toBe(15);
    const msgs = await ns.db.listMessages();
    expect(msgs.every((m) => m.category)).toBe(true);
    expect(msgs.find((m) => m.provider_message_id === "ns-005")!.status).toBe("no_reply"); // spam
    expect(msgs.find((m) => m.provider_message_id === "ns-004")!.urgent).toBe(true); // after-hours emergency
    expect(msgs.find((m) => m.provider_message_id === "ns-015")!.urgent).toBe(true); // gas smell
  });

  it("masks the test card number and SSN everywhere: messages, drafts, logs, usage", async () => {
    const sql = getSql();
    const tables = ["messages", "drafts", "audit_log", "approvals", "sent_messages", "usage_events", "kb_chunks", "kb_documents", "briefs", "news_items"];
    for (const t of tables) {
      const rows = await sql.unsafe(`select (t.*)::text as row from ${t} t where tenant_id = $1`, [ns.db.tenantId]);
      for (const r of rows) {
        expect(r.row, t).not.toMatch(/4111[ -]?1111[ -]?1111[ -]?1111|123-45-6789/);
      }
    }
    const m = (await ns.db.listMessages()).find((x) => x.provider_message_id === "ns-006")!;
    expect(m.body).toContain("[CARD NUMBER REMOVED]");
    expect(m.body).toContain("[ID NUMBER REMOVED]");
    expect(m.masked_flags.sort()).toEqual(["card", "ssn"]);
    const logs = await ns.db.listAudit({ q: "guard_masked" });
    expect(logs.length).toBeGreaterThan(0);
  });

  it("treats the injection trap as a normal email and escalates it", async () => {
    const d = await draftFor(ns.db, "ns-010");
    expect(d.status).toBe("escalated");
    expect(d.escalation_reason).toMatch(/injection/);
    expect(d.body).not.toMatch(/client records|developer mode|forward/i);
    expect(d.model).toBe("template"); // no drafting model ever saw it
  });
});

describe("Cabinet + draft", () => {
  it("unanswerable question gets 'let me check' and is escalated, never an invented fact", async () => {
    const d = await draftFor(ns.db, "ns-009");
    expect(d.status).toBe("escalated");
    expect(d.body).toMatch(/checking on this and will follow up/);
    expect(d.body).not.toMatch(/discount|certified|\d+%/i);
    expect(d.escalation_reason).toMatch(/not in the knowledge base/);
  });

  it("answers from the knowledge base with sources attached", async () => {
    const d = await draftFor(ns.db, "ns-002");
    expect(d.status).toBe("pending");
    expect(d.body).toContain("$89");
    expect(d.sources.length).toBeGreaterThan(0);
    expect(d.sources.map((s) => s.title)).toContain("Pricing");
  });

  it("replies in Spanish to the Spanish message", async () => {
    const d = await draftFor(ns.db, "ns-007");
    expect(d.body).toMatch(/Hola Rosa/);
  });

  it("escalates complaints, legal threats and messages that contained sensitive data", async () => {
    for (const id of ["ns-003", "ns-014", "ns-006"]) expect((await draftFor(ns.db, id)).status).toBe("escalated");
  });

  it("answers the long messy thread from its newest message", async () => {
    const d = await draftFor(ns.db, "ns-008");
    expect(d.body).toMatch(/Brandon/);
  });
});

describe("Approval tray + send", () => {
  it("approve sends exactly once, with the approved text", async () => {
    const d = await draftFor(ns.db, "ns-002");
    const r = await approve(d.id);
    expect(r).toMatchObject({ ok: true, sent: true, status: "sent" });
    expect(ns.provider.sent).toHaveLength(1);
    expect(ns.provider.sent[0].body).toBe(d.body);
    expect(await sentCount(ns.db)).toBe(1);
    // A second click (or a double-submit) never sends again.
    const again = await approve(d.id);
    expect(again.ok).toBe(false);
    expect(ns.provider.sent).toHaveLength(1);
    const actions = (await ns.db.listAudit()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["approved", "sent"]));
  });

  it("edit-then-approve sends the edited version only", async () => {
    const d = await draftFor(ns.db, "ns-013");
    const edited = "Hi Gina,\n\nOur maintenance plan is $189 per year. Want me to sign you up?\n\nJim";
    const r = await decide(ns.db, ns.provider, ns.owner, d.id, { kind: "edit_approve", body: edited });
    expect(r.sent).toBe(true);
    expect(ns.provider.sent.map((s) => s.body)).toEqual([edited]);
    const stored = await ns.db.sentFor(d.id);
    expect(stored!.body).toBe(edited);
  });

  it("an edit that pastes a card number is masked on the way out", async () => {
    const d = await draftFor(ns.db, "ns-011");
    await decide(ns.db, ns.provider, ns.owner, d.id, { kind: "edit_approve", body: "Use card 4111 1111 1111 1111" });
    expect(ns.provider.sent[0].body).not.toContain("4111");
  });

  it("reject sends nothing", async () => {
    const d = await draftFor(ns.db, "ns-012");
    const r = await decide(ns.db, ns.provider, ns.owner, d.id, { kind: "reject" });
    expect(r).toMatchObject({ ok: true, sent: false, status: "rejected" });
    expect(ns.provider.sent).toHaveLength(0);
    expect((await approve(d.id)).ok).toBe(false); // can't approve after rejecting
    expect(ns.provider.sent).toHaveLength(0);
  });

  it("escalate sends nothing", async () => {
    const d = await draftFor(ns.db, "ns-012");
    const r = await decide(ns.db, ns.provider, ns.owner, d.id, { kind: "escalate", note: "I'll call them" });
    expect(r.sent).toBe(false);
    expect(ns.provider.sent).toHaveLength(0);
  });

  it("a draft left sitting sends nothing, whatever runs in the background", async () => {
    await processTenant(ns.db, ns.provider);
    await processTenant(ns.db, ns.provider);
    await maybeRunBriefs(ns.db, new Date(), async () => "<rss></rss>");
    expect(ns.provider.sent).toHaveLength(0);
    expect(await sentCount(ns.db)).toBe(0);
    const pending = await ns.db.listDrafts(["pending", "escalated"]);
    expect(pending.length).toBe(14);
  });

  it("a crash mid-send (restart) sends nothing until a human approves again, then exactly once", async () => {
    const d = await draftFor(ns.db, "ns-002");
    ns.provider.failNext = true;
    const r = await approve(d.id);
    expect(r).toMatchObject({ ok: false, sent: false });
    expect(ns.provider.sent).toHaveLength(0);
    // "restart": background work runs again; nothing is sent automatically.
    await processTenant(ns.db, ns.provider);
    expect(ns.provider.sent).toHaveLength(0);
    expect((await ns.db.draft(d.id))!.status).toBe("approved");
    // A human retries from the tray.
    const retry = await approve(d.id);
    expect(retry.sent).toBe(true);
    expect(ns.provider.sent).toHaveLength(1);
    expect(await sentCount(ns.db)).toBe(1);
  });

  it("approvers clicking at the same moment send once (repeated to shake out races)", async () => {
    const second = await user("approver2@northstar.example", ns.db.tenantId, "approver");
    const ids = ["ns-002", "ns-011", "ns-012", "ns-013", "ns-008"];
    for (const pid of ids) {
      const d = await draftFor(ns.db, pid);
      const results = await Promise.all([approve(d.id), approve(d.id, second), approve(d.id), approve(d.id, second)]);
      expect(results.filter((r) => r.sent), pid).toHaveLength(1);
    }
    expect(ns.provider.sent).toHaveLength(ids.length);
    expect(await sentCount(ns.db)).toBe(ids.length);
  });

  it("a send whose outcome is unknown (crash during the mailbox call) is never retried automatically", async () => {
    const d = await draftFor(ns.db, "ns-002");
    const hang = { ...ns.provider, send: () => new Promise<never>(() => {}) };
    void decide(ns.db, hang, ns.owner, d.id, { kind: "approve" }); // never resolves: simulates a process killed mid-send
    await new Promise((r) => setTimeout(r, 300));
    expect((await ns.db.sendState(d.id))?.status).toBe("sending");
    const retry = await approve(d.id);
    expect(retry.sent).toBe(false);
    expect(ns.provider.sent).toHaveLength(0);
  });

  it("viewers cannot approve", async () => {
    const v = await user("viewer@northstar.example", ns.db.tenantId, "viewer");
    const d = await draftFor(ns.db, "ns-002");
    const r = await decide(ns.db, ns.provider, v, d.id, { kind: "approve" });
    expect(r.ok).toBe(false);
    expect(ns.provider.sent).toHaveLength(0);
  });

  it("shadow mode: approve is recorded, nothing is sent, the logbook says 'would have sent'", async () => {
    await ns.db.setShadowMode(true);
    const d = await draftFor(ns.db, "ns-002");
    const r = await approve(d.id);
    expect(r).toMatchObject({ ok: true, sent: false, shadow: true });
    expect(ns.provider.sent).toHaveLength(0);
    expect(await sentCount(ns.db)).toBe(0);
    const log = await ns.db.listAudit({ q: "shadow" });
    expect(log[0].detail).toMatch(/^shadow: would have sent/);
  });
});

describe("Scheduling", () => {
  it("offers open times and never double-books", async () => {
    const maria = await draftFor(ns.db, "ns-001");
    const rosa = await draftFor(ns.db, "ns-007");
    expect(maria.proposed_slots.length).toBeGreaterThan(0);
    // Both drafts were created before either was approved, so they offer the same first time.
    expect(rosa.proposed_slots[0].start).toBe(maria.proposed_slots[0].start);
    expect((await approve(maria.id)).sent).toBe(true);
    const second = await approve(rosa.id);
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/just taken/);
    expect(ns.provider.sent).toHaveLength(1);
    // The database itself refuses an overlapping hold.
    const s = maria.proposed_slots[0];
    expect(await ns.db.insertHold({ draftId: rosa.id, start: new Date(s.start), end: new Date(s.end) })).toBe(false);
    // New drafts skip times that are already held.
    await storeInbound(ns.db, "demo", { ...NORTH_STAR_INBOX[0], providerMessageId: "ns-100", fromName: "Ana Diaz", fromAddr: "ana@example.com" });
    await processTenant(ns.db, null);
    const ana = await draftFor(ns.db, "ns-100");
    expect(ana.proposed_slots.map((x) => x.start)).not.toContain(s.start);
  });
});

describe("Meter, budget cap, /pause", () => {
  it("every AI call is metered with model, task and cost", async () => {
    const usage = await ns.db.usageByTask(new Date(0));
    expect(usage.map((u) => u.task).sort()).toEqual(expect.arrayContaining(["draft", "sort"]));
    expect(usage.every((u) => u.model.length > 0)).toBe(true);
  });

  it("alerts at 80% and pauses drafting at the cap", async () => {
    await ns.db.insertUsage({ task: "draft", route: "large", model: "gpt-6.1-sol", inputTokens: 0, outputTokens: 0, costUsd: 16.5 });
    await storeInbound(ns.db, "demo", { ...NORTH_STAR_INBOX[1], providerMessageId: "ns-200" });
    await processTenant(ns.db, null);
    expect(await ns.db.auditCount("budget_alert", new Date(0))).toBe(1);
    expect((await draftFor(ns.db, "ns-200")).status).toBe("pending"); // under the cap: still drafting

    await ns.db.insertUsage({ task: "draft", route: "large", model: "gpt-6.1-sol", inputTokens: 0, outputTokens: 0, costUsd: 4 });
    await storeInbound(ns.db, "demo", { ...NORTH_STAR_INBOX[1], providerMessageId: "ns-201" });
    await processTenant(ns.db, null);
    const m = (await ns.db.listMessages()).find((x) => x.provider_message_id === "ns-201")!;
    expect(m.status).toBe("waiting_budget");
    await expect(draftFor(ns.db, "ns-201")).rejects.toThrow(/no draft/);
    expect(await ns.db.auditCount("drafting_paused_budget", new Date(0))).toBeGreaterThan(0);
  });

  it("pause stops all processing and sending for one tenant only; resume sends nothing by itself", async () => {
    const other = await otherTenant("pause-neighbor");
    await pause(ns.db, "owner@northstar.example");
    await storeInbound(ns.db, "demo", { ...NORTH_STAR_INBOX[1], providerMessageId: "ns-300" });
    const r = await processTenant(ns.db, ns.provider);
    expect(r.paused).toBe(true);
    expect((await ns.db.listMessages()).find((m) => m.provider_message_id === "ns-300")!.status).toBe("new");
    const d = await draftFor(ns.db, "ns-002");
    const blocked = await approve(d.id);
    expect(blocked.ok).toBe(false);
    expect(ns.provider.sent).toHaveLength(0);

    // The neighbouring tenant keeps working.
    const run = await processTenant(other.db, other.provider);
    expect(run.paused).toBe(false);
    expect(run.stored).toBe(15);

    await resume(ns.db, "owner@northstar.example");
    await processTenant(ns.db, ns.provider);
    expect(ns.provider.sent).toHaveLength(0); // nothing queued during pause is sent
    expect((await draftFor(ns.db, "ns-300")).status).toBe("pending");
    const actions = (await ns.db.listAudit()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["paused", "resumed", "send_blocked_paused"]));
  });
});

describe("Tenant isolation", () => {
  it("one client can never see or act on another client's data", async () => {
    const b = await otherTenant("isolation-b");
    const nsDraft = await draftFor(ns.db, "ns-002");
    expect(await b.db.draft(nsDraft.id)).toBeNull();
    expect(await b.db.message(nsDraft.message_id)).toBeNull();
    expect(await b.db.listDrafts(["pending", "escalated"])).toHaveLength(0);
    expect(await b.db.listMessages()).toHaveLength(0);
    const r = await decide(b.db, b.provider, b.owner, nsDraft.id, { kind: "approve" });
    expect(r.ok).toBe(false);
    expect(b.provider.sent).toHaveLength(0);
    expect(ns.provider.sent).toHaveLength(0);
    // A tenant's own owner has no role in another tenant.
    expect(await tenantDb(b.db.tenantId).memberRole(ns.owner.userId)).toBeNull();
    // An approval proof from one tenant is refused by another tenant's mailbox.
    await expect(b.provider.send({ to: "x@example.com", subject: "x", body: "x" }, { tenantId: ns.db.tenantId, draftId: nsDraft.id, approvalId: "00000000-0000-0000-0000-000000000000" } as never)).rejects.toThrow(/another tenant/);
  });
});

describe("Briefs", () => {
  it("daily brief ends in 3–5 next steps and the Monday radar runs on Mondays", async () => {
    const monday = new Date("2026-11-16T15:00:00Z"); // 9 a.m. in Chicago, a Monday
    const made = await maybeRunBriefs(ns.db, monday, async (url) =>
      url.includes("news.google.com") ? "<rss><item><title>Heat pump rebates expand in South Dakota</title><link>https://example.com/a</link></item></rss>" : "<html>competitor</html>",
    );
    expect(made).toEqual(["2026-11-16"]);
    const brief = await ns.db.brief("daily", "2026-11-16");
    const c = brief!.content as { nextSteps: string[]; radar?: unknown; news: unknown[] };
    expect(c.nextSteps.length).toBeGreaterThanOrEqual(3);
    expect(c.nextSteps.length).toBeLessThanOrEqual(5);
    expect(c.radar).toBeTruthy();
    expect(c.news.length).toBe(1);
    // Runs once per day.
    expect(await maybeRunBriefs(ns.db, monday, async () => "")).toEqual([]);
  });
});
