// The Cabinet rule, enforced in code after every draft (whatever the model says):
// a draft may state only facts found in the tenant's knowledge base. Numbers,
// prices, percentages, times, phone numbers, links and email addresses in a draft
// must appear in the allowed text, or the draft is replaced with a "let me check"
// reply and escalated.

export interface FactCheck {
  ok: boolean;
  unsupported: string[];
}

const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const NUMBER = /\d[\d,.:/-]*\d|\d/g;
const LINK = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|us|co|biz|info|example)(?:\/[^\s)]*)?/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const digits = (s: string) => s.replace(/\D/g, "");
const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[).,;:!?]+$/, "");

export function checkFacts(draft: string, allowed: { kb: string; context: string }): FactCheck {
  const unsupported = new Set<string>();
  const kbDigits = new Set((allowed.kb.match(NUMBER) ?? []).map(digits));
  const allText = `${allowed.kb}\n${allowed.context}`;
  const allDigits = new Set((allText.match(NUMBER) ?? []).map(digits));
  const allLower = allText.toLowerCase();

  // Money may only come from the knowledge base itself (never from the customer's email).
  for (const m of draft.match(MONEY) ?? []) {
    if (!kbDigits.has(digits(m))) unsupported.add(m.trim());
  }
  const draftNoMoney = draft.replace(MONEY, " ");
  for (const n of draftNoMoney.match(NUMBER) ?? []) {
    const d = digits(n);
    if (!d) continue;
    // Small counting words like "1" or "2" in "1 to 2 hours" still have to appear somewhere allowed.
    if (!allDigits.has(d) && ![...allDigits].some((a) => a.includes(d) && d.length >= 3)) unsupported.add(n);
  }
  for (const l of draft.match(EMAIL) ?? []) {
    if (!allLower.includes(l.toLowerCase())) unsupported.add(l);
  }
  for (const l of draft.replace(EMAIL, " ").match(LINK) ?? []) {
    if (!allLower.includes(norm(l))) unsupported.add(l);
  }
  return { ok: unsupported.size === 0, unsupported: [...unsupported] };
}

const greetName = (name: string) => (name ? name.split(/\s+/)[0] : "");

export function letMeCheckReply(lang: "en" | "es", fromName: string, signature: string) {
  const n = greetName(fromName);
  if (lang === "es") {
    return `Hola${n ? ` ${n}` : ""},\n\nGracias por escribirnos. Quiero darle información correcta, así que lo voy a verificar y le responderé pronto.\n\n${signature}`.trim();
  }
  return `Hi${n ? ` ${n}` : ""},\n\nThanks for reaching out. I want to make sure I give you accurate information, so I'm checking on this and will follow up shortly.\n\n${signature}`.trim();
}

export function holdingReply(lang: "en" | "es", fromName: string, ownerName: string, signature: string, sensitive: boolean) {
  const n = greetName(fromName);
  const who = ownerName || "the owner";
  if (lang === "es") {
    const sec = sensitive ? "\n\nPor su seguridad, no envíe números de tarjeta ni de Seguro Social por correo. Los eliminamos de nuestro sistema." : "";
    return `Hola${n ? ` ${n}` : ""},\n\nGracias por su mensaje. Se lo he pasado a ${who}, quien le responderá directamente.${sec}\n\n${signature}`.trim();
  }
  const sec = sensitive ? "\n\nFor your security, please don't send card or Social Security numbers by email. We've removed them from our system." : "";
  return `Hi${n ? ` ${n}` : ""},\n\nThank you for your message. I've passed it to ${who} personally, and they will get back to you directly.${sec}\n\n${signature}`.trim();
}
