import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Proof that there is no send path except the approve action.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const src = files("src").map((f) => ({ f, text: readFileSync(f, "utf8") }));

describe("No auto-send", () => {
  it("provider.send() is called from exactly one place: src/lib/approvals.ts", () => {
    const callers = src.filter(({ f, text }) => /\bprovider\.send\(|\bmailer\.send\(|\.send\(\s*\{\s*to:/.test(text) && !f.endsWith(path.join("mail", "types.ts")));
    expect(callers.map((c) => c.f)).toEqual([path.join("src", "lib", "approvals.ts")]);
  });
  it("only approvals.ts can mint an ApprovalProof", () => {
    const minters = src.filter(({ text }) => /as ApprovalProof/.test(text)).map((c) => c.f);
    expect(minters).toEqual([path.join("src", "lib", "approvals.ts")]);
  });
  it("in approvals.ts, the send happens only after an approval is recorded", () => {
    const a = readFileSync("src/lib/approvals.ts", "utf8");
    const insertApproval = a.indexOf("insertApproval({ draftId: d.id, userId: actor.userId, action: decision.kind })");
    const send = a.indexOf("await provider.send(");
    expect(insertApproval).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(insertApproval);
    const proof = a.indexOf("mintProof(db.tenantId, draft.id, approvalId)");
    const claim = a.indexOf("await db.claimSend(");
    // approval recorded → proof minted → send claimed in the DB → mailbox called
    expect(proof).toBeGreaterThan(insertApproval);
    expect(claim).toBeGreaterThan(proof);
    expect(send).toBeGreaterThan(claim);
    expect(a.slice(claim, send)).toContain("if (!claimId) return");
  });
  it("every mailbox send endpoint is behind verifyProof()", () => {
    const p = readFileSync("src/lib/mail/providers.ts", "utf8");
    const sends = [...p.matchAll(/async send\([^)]*\)\s*\{\s*([^\n]*)/g)].map((m) => m[1]);
    expect(sends.length).toBeGreaterThanOrEqual(2); // demo + gmail (microsoft is a throwing stub)
    for (const first of sends) expect(first).toContain("verifyProof(db, proof)");
    expect((p.match(/messages\/send/g) ?? []).length).toBe(1);
  });
  it("the pipeline, cron, briefs and notifier contain no send path", () => {
    for (const f of ["src/lib/pipeline.ts", "src/app/api/cron/tick/route.ts", "src/lib/briefs.ts", "src/lib/notify.ts", "src/lib/control.ts"]) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\.send\(\s*\{|messages\/send|approvals"|from "@\/lib\/approvals"/);
    }
  });
  it("there is no auto-send setting anywhere", () => {
    const hits = src.filter(({ text }) => /auto_?send|autoSend|sendWithoutApproval|skipApproval/i.test(text) && !/auto-\?send/.test(text));
    expect(hits.map((h) => h.f)).toEqual([]);
  });
});
