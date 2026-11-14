// The Guard. Runs on every piece of outside text BEFORE it is stored, shown,
// logged, or sent to any AI model, and again on every outgoing reply.
// Ported and extended from python-v0/sba/guard.py.

export type MaskFlag = "card" | "ssn" | "password" | "bank_account";

export interface GuardResult {
  text: string;
  flags: MaskFlag[];
  count: number;
}

const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const SSN_DASHED = /\b\d{3}-\d{2}-\d{4}\b/g;
const SSN_LABELED = /\b(ssn|social security(?: number| no\.?)?)(\s*[:#]?\s*)(\d{3}[ -]?\d{2}[ -]?\d{4})\b/gi;
const SECRET = /\b(password|passcode|passwd|pwd|pin|api[_ -]?key|secret)(\s*(?:is|:|=)\s*)(\S+)/gi;
const BANK = /\b(account|acct|routing|aba|iban)(\s*(?:number|no\.?|num|#))?(\s*(?:is|:|#)?\s*)([A-Z]{2}\d{2}[A-Z0-9]{8,30}|\d[\d -]{4,20}\d)\b/gi;

export const MASK = {
  card: "[CARD NUMBER REMOVED]",
  ssn: "[ID NUMBER REMOVED]",
  password: "[REMOVED]",
  bank_account: "[ACCOUNT NUMBER REMOVED]",
} as const;

function luhn(digits: string): boolean {
  let total = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
    alt = !alt;
  }
  return total % 10 === 0;
}

export function guard(input: string | null | undefined): GuardResult {
  let text = input ?? "";
  const flags = new Set<MaskFlag>();
  let count = 0;

  text = text.replace(SSN_LABELED, (_m, label: string, sep: string) => {
    flags.add("ssn");
    count++;
    return `${label}${sep}${MASK.ssn}`;
  });
  text = text.replace(SSN_DASHED, () => {
    flags.add("ssn");
    count++;
    return MASK.ssn;
  });
  text = text.replace(CARD, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      flags.add("card");
      count++;
      return MASK.card;
    }
    return m;
  });
  text = text.replace(BANK, (m, label: string, kind: string | undefined, sep: string, value: string) => {
    const digits = value.replace(/\D/g, "");
    if (/^[A-Z]{2}\d{2}/i.test(value) || digits.length >= 6) {
      flags.add("bank_account");
      count++;
      return `${label}${kind ?? ""}${sep}${MASK.bank_account}`;
    }
    return m;
  });
  text = text.replace(SECRET, (_m, label: string, sep: string) => {
    flags.add("password");
    count++;
    return `${label}${sep}${MASK.password}`;
  });

  return { text, flags: [...flags], count };
}

/** Convenience: masked text only. Used by the logbook and anything that renders. */
export function mask(input: string | null | undefined): string {
  return guard(input).text;
}

const INJECTION =
  /(ignore (all |your |the |any |previous |prior )*(rules|instructions|prompts?|guidelines)|system prompt|developer mode|jailbreak|you are now|act as (an? )?(admin|developer|system)|reveal (your|the) (rules|instructions|prompt)|forward (all|every) (emails?|messages?)|send (me )?(all|every) (customer|client|patient|member)s?'? ?(data|records|emails|list)|disregard (the|your|all) (rules|instructions)|auto-?send|send (this|the reply) (now|immediately) without|new instructions?:|override (your|the) (rules|policy))/i;

export function looksLikeInjection(text: string | null | undefined): boolean {
  return INJECTION.test(text ?? "");
}

export function matchEscalation(text: string, keywords: string[]): string | null {
  const low = text.toLowerCase();
  for (const k of keywords) {
    const kw = k.trim().toLowerCase();
    if (!kw) continue;
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(low)) return k;
  }
  return null;
}

/** Wrap outside content so the model treats it as data, never as instructions. */
export function asUntrusted(label: string, text: string, limit = 8000): string {
  const clean = text.slice(0, limit).replaceAll(`</${label}`, `&lt;/${label}`);
  return `<${label}>\n${clean}\n</${label}>`;
}

/** Remove quoted history from a messy thread so we sort and draft on the newest message. */
export function stripQuoted(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)/i.test(line.trim())) break;
    if (/^From:\s.+/.test(line.trim()) && out.length > 0) break;
    if (line.trim().startsWith(">")) continue;
    out.push(line);
  }
  const s = out.join("\n").trim();
  return s.length > 0 ? s : body.trim();
}

const SPANISH = /\b(hola|gracias|por favor|necesito|quiero|cuánto|cuanto|cita|precio|mañana|buenos días|buenas|usted|aire acondicionado|calefacción|cuándo|disponible)\b/gi;

export function detectLanguage(text: string): "en" | "es" {
  const hits = (text.match(SPANISH) ?? []).length;
  return hits >= 2 ? "es" : "en";
}
