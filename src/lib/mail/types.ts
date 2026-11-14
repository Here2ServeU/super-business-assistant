export interface InboundMail {
  providerMessageId: string;
  threadId: string | null;
  fromAddr: string;
  fromName: string;
  toAddr: string;
  subject: string;
  body: string; // RAW. Must pass through guard() before it is stored anywhere.
  receivedAt: Date;
}

export interface OutboundMail {
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyToProviderId?: string | null;
}

declare const proofBrand: unique symbol;

/**
 * Proof that a human approved this exact draft. It can only be created inside
 * src/lib/approvals.ts (the brand is not constructible elsewhere without a cast,
 * and tests/no-auto-send.test.ts rejects casts to it), and every provider
 * re-checks it against the database before sending.
 */
export interface ApprovalProof {
  readonly [proofBrand]: true;
  tenantId: string;
  draftId: string;
  approvalId: string;
}

export interface BusyBlock {
  start: Date;
  end: Date;
}

export interface MailProvider {
  readonly name: "gmail" | "microsoft" | "demo";
  fetchNew(max: number): Promise<InboundMail[]>;
  send(mail: OutboundMail, proof: ApprovalProof): Promise<{ providerMessageId: string | null }>;
  busy(from: Date, to: Date): Promise<BusyBlock[]>;
  createHold(h: { start: Date; end: Date; title: string }, proof: ApprovalProof): Promise<void>;
}
