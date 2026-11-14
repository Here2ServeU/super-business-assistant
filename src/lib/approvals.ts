import { withTenantTx, type DraftRow, type Role, type TenantDb } from "@/lib/dal";
import { guard } from "@/lib/guard";
import type { ApprovalProof, MailProvider } from "@/lib/mail/types";

// THE ONLY PLACE EMAIL IS EVER SENT.
// approveDraft() records a human approval first, then sends. There is no other
// exported function in the codebase that calls provider.send(); the test
// tests/no-auto-send.test.ts greps the source tree to prove it.

export type Decision =
  | { kind: "approve" }
  | { kind: "edit_approve"; body: string }
  | { kind: "escalate"; note?: string }
  | { kind: "reject"; note?: string };

export interface DecisionResult {
  ok: boolean;
  status: DraftRow["status"];
  sent: boolean;
  shadow?: boolean;
  message: string;
}

const CAN_DECIDE: Role[] = ["owner", "approver"];

function mintProof(tenantId: string, draftId: string, approvalId: string): ApprovalProof {
  return { tenantId, draftId, approvalId } as ApprovalProof;
}

export async function decide(
  db: TenantDb,
  provider: MailProvider | null,
  actor: { userId: string; email: string; role: Role },
  draftId: string,
  decision: Decision,
): Promise<DecisionResult> {
  if (!CAN_DECIDE.includes(actor.role)) {
    await db.audit(actor.email, "decision_refused", draftId, `role ${actor.role} cannot approve`);
    return { ok: false, status: "pending", sent: false, message: "Viewers can't approve drafts." };
  }

  // Step 1: record the human decision atomically (row lock prevents two approvers racing).
  const step = await withTenantTx(db, async (tx) => {
    const d = await tx.lockDraft(draftId);
    if (!d) return { error: "Draft not found." } as const;
    const settings = await tx.settings();
    const open = d.status === "pending" || d.status === "escalated";
    // A previous approval that never reached the mailbox (crash, outage) may be retried by a human.
    const retry = (d.status === "approved" || d.status === "edited") && !(await tx.sentFor(d.id)) && (decision.kind === "approve" || decision.kind === "edit_approve");
    if (!open && !retry) return { error: `This draft is already ${d.status}.` } as const;

    if (decision.kind === "reject" || decision.kind === "escalate") {
      await tx.insertApproval({ draftId: d.id, userId: actor.userId, action: decision.kind, note: decision.note });
      const status = decision.kind === "reject" ? "rejected" : "escalated";
      await tx.updateDraft(d.id, { status, escalate: decision.kind === "escalate" ? true : d.escalate });
      await tx.releaseHolds(d.id);
      await tx.audit(actor.email, decision.kind === "reject" ? "rejected" : "escalated_by_human", d.id, decision.note ?? "");
      return { done: { ok: true, status, sent: false, message: decision.kind === "reject" ? "Rejected. Nothing was sent." : "Escalated. Nothing was sent." } } as const;
    }

    if (settings.paused) {
      await tx.audit(actor.email, "send_blocked_paused", d.id, "approval refused while paused");
      return { error: "The assistant is paused. Resume it before approving." } as const;
    }

    let finalBody = d.final_body ?? d.body;
    if (decision.kind === "edit_approve") {
      const g = guard(decision.body);
      if (!g.text.trim()) return { error: "The edited reply is empty." } as const;
      finalBody = g.text;
      if (g.count) await tx.audit("guard", "guard_masked_outgoing", d.id, `masked ${g.flags.join(", ")} in the edited reply`);
    }
    const approvalId = retry
      ? (await tx.approvalFor(d.id))!.id
      : await tx.insertApproval({ draftId: d.id, userId: actor.userId, action: decision.kind });
    const status = decision.kind === "edit_approve" || d.status === "edited" ? "edited" : "approved";
    await tx.updateDraft(d.id, { status, final_body: finalBody });
    await tx.audit(actor.email, decision.kind === "edit_approve" ? "edited_and_approved" : "approved", d.id, retry ? "retry of an approved draft that was not sent" : "");

    // Calendar holds for the times the final reply still offers. The DB refuses overlaps.
    const slots = d.proposed_slots.filter((s) => finalBody.includes(s.label));
    await tx.releaseHolds(d.id); // a retry replaces this draft's own earlier holds
    for (const s of slots) {
      const okHold = await tx.insertHold({ draftId: d.id, start: new Date(s.start), end: new Date(s.end) });
      if (!okHold) {
        await tx.audit("assistant", "hold_conflict", d.id, `${s.label} is no longer free`);
        throw new HoldConflict(s.label);
      }
    }
    return { approved: { draft: d, approvalId, finalBody, slots, shadow: settings.shadowMode } } as const;
  }).catch(async (e) => {
    if (e instanceof HoldConflict) {
      // The transaction rolled back (no approval recorded); log the refusal outside it.
      await db.audit("assistant", "hold_conflict", draftId, `${e.label} is no longer free; approval not recorded`);
      return { error: `${e.label} was just taken by another booking. Edit the times and approve again.` } as const;
    }
    throw e;
  });

  if ("error" in step) return { ok: false, status: "pending", sent: false, message: step.error ?? "" };
  if ("done" in step && step.done) return step.done;
  if (!("approved" in step) || !step.approved) throw new Error("unexpected approval state");

  const { draft, approvalId, finalBody, slots, shadow } = step.approved;
  const outgoing = guard(finalBody).text; // the Guard runs again on the way out

  // Step 2: send — only now, only with a recorded approval.
  if (shadow) {
    await db.audit("assistant", "shadow_would_send", draft.id, `shadow: would have sent to ${draft.to_addr}: "${draft.subject}"`);
    return { ok: true, status: draft.status === "edited" || finalBody !== draft.body ? "edited" : "approved", sent: false, shadow: true, message: "Approved in shadow mode. Nothing was sent." };
  }
  if (!provider) {
    await db.audit("assistant", "send_failed", draft.id, "no mailbox connected");
    return { ok: false, status: "approved", sent: false, message: "Approved, but no mailbox is connected. Connect one, then approve again to send." };
  }
  const message = await db.message(draft.message_id);
  const proof = mintProof(db.tenantId, draft.id, approvalId);
  try {
    if (await db.sentFor(draft.id)) return { ok: true, status: "sent", sent: false, message: "Already sent." };
    const res = await provider.send({ to: draft.to_addr, subject: draft.subject, body: outgoing, threadId: message?.thread_id, inReplyToProviderId: message?.provider_message_id }, proof);
    const sentId = await db.insertSent({ draftId: draft.id, approvalId, provider: provider.name, providerMessageId: res.providerMessageId, toAddr: draft.to_addr, subject: draft.subject, body: outgoing });
    await db.updateDraft(draft.id, { status: "sent" });
    if (message) await db.updateMessage(message.id, { status: "done" });
    await db.audit("assistant", "sent", draft.id, `to ${draft.to_addr}: "${draft.subject}"${sentId ? "" : " (duplicate ignored)"}`);
    for (const s of slots) {
      try {
        await provider.createHold({ start: new Date(s.start), end: new Date(s.end), title: draft.subject }, proof);
      } catch (e) {
        await db.audit("assistant", "calendar_hold_failed", draft.id, (e as Error).message);
      }
    }
    return { ok: true, status: "sent", sent: true, message: "Approved and sent." };
  } catch (e) {
    await db.audit("assistant", "send_failed", draft.id, (e as Error).message);
    return { ok: false, status: "approved", sent: false, message: `Approved, but sending failed: ${(e as Error).message}. Approve again to retry.` };
  }
}

class HoldConflict extends Error {
  constructor(public label: string) {
    super(`hold conflict: ${label}`);
  }
}
