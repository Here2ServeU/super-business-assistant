import type { Profile } from "@/lib/settings";

// Starting profiles for self-signup, by business type. Escalation words come from
// the python-v0 industry presets. Everything here is editable later in Settings.
// No knowledge-base facts are pre-filled: until the owner adds their own, every
// draft says "let me check" and comes to them.

type Cat = Profile["categories"][number];
const c = (name: string, keywords: string[], reply = true, scheduling = false): Cat => ({ name, keywords, reply, scheduling });
const junk = c("Junk", ["unsubscribe", "prize", "winner", "seo services", "guest post"], false);
const COMMON_ESCALATE = ["refund", "complaint", "lawsuit", "attorney", "lawyer", "chargeback", "cancel", "review"];

export interface Starter {
  label: string;
  categories: Cat[];
  urgentKeywords: string[];
  alwaysEscalate: string[];
}

export const STARTERS: Record<string, Starter> = {
  home_services: {
    label: "Home services (HVAC, plumbing, electrical, cleaning)",
    categories: [c("Booking", ["book", "appointment", "schedule", "estimate", "come out"], true, true), c("Price question", ["price", "cost", "how much", "quote"]), c("Service question", ["hours", "area", "serve", "do you"]), c("Emergency", ["emergency", "leak", "no heat", "no power", "flood"]), c("Billing", ["invoice", "payment", "bill"]), junk],
    urgentKeywords: ["emergency", "leak", "flood", "no heat", "gas smell", "smell gas", "no power", "sparks"],
    alwaysEscalate: [...COMMON_ESCALATE, "injury", "damage", "warranty"],
  },
  restaurant: {
    label: "Restaurant or café",
    categories: [c("Reservation", ["reservation", "book", "table", "party of"], true, true), c("Catering / events", ["catering", "event", "private party"]), c("Menu question", ["menu", "gluten", "vegan", "allergy", "hours"]), c("Order issue", ["order", "delivery", "wrong", "missing"]), junk],
    urgentKeywords: ["tonight", "today", "allergic", "sick"],
    alwaysEscalate: ["refund", "sick", "food poisoning", "allergic reaction", "complaint", "health department", "lawsuit", "injury", "review", "cancel"],
  },
  salon: {
    label: "Salon, spa or barber",
    categories: [c("Booking", ["book", "appointment", "available", "opening"], true, true), c("Price question", ["price", "cost", "how much"]), c("Service question", ["hours", "do you", "color", "cut"]), junk],
    urgentKeywords: ["today", "reaction", "burn"],
    alwaysEscalate: ["refund", "reaction", "burn", "allergic", "complaint", "redo", "unhappy", "review", "cancel"],
  },
  auto_repair: {
    label: "Auto repair",
    categories: [c("Booking", ["appointment", "book", "drop off", "schedule"], true, true), c("Quote", ["quote", "price", "cost", "how much", "estimate"]), c("Status", ["ready", "status", "done", "pick up"]), junk],
    urgentKeywords: ["tow", "stranded", "won't start", "brakes"],
    alwaysEscalate: ["refund", "warranty", "accident", "unsafe", "complaint", "damage", "review", "cancel"],
  },
  retail: {
    label: "Retail store",
    categories: [c("Product question", ["in stock", "available", "size", "color", "do you carry"]), c("Order", ["order", "shipping", "delivery", "tracking"]), c("Returns", ["return", "exchange"]), c("Hours / location", ["hours", "open", "location"]), junk],
    urgentKeywords: ["today", "urgent"],
    alwaysEscalate: ["refund", "chargeback", "damaged", "defective", "complaint", "lawsuit", "wholesale", "bulk order", "review", "cancel"],
  },
  law_office: {
    label: "Law office",
    categories: [c("Consultation request", ["consultation", "consult", "appointment", "meet"], true, true), c("Existing client", ["my case", "update", "documents"]), c("General question", ["hours", "fees", "do you handle"]), junk],
    urgentKeywords: ["deadline", "court", "hearing", "arrest", "served", "urgent"],
    alwaysEscalate: ["deadline", "court", "hearing", "subpoena", "served", "custody", "arrest", "divorce", "complaint", "refund", "fee", "malpractice", "bar", "urgent", "statute"],
  },
  church: {
    label: "Church or ministry",
    categories: [c("Visit / service times", ["service", "sunday", "worship", "visit", "times"]), c("Events", ["event", "youth", "bible study", "volunteer"]), c("Pastoral care", ["pray", "prayer", "hospital", "counsel"]), junk],
    urgentKeywords: ["emergency", "hospital", "crisis", "suicide", "died"],
    alwaysEscalate: ["prayer", "pray", "funeral", "died", "death", "hospital", "sick", "crisis", "suicide", "abuse", "divorce", "counsel", "wedding", "pastor", "help me", "emergency"],
  },
  professional: {
    label: "Consulting or professional services",
    categories: [c("Book a call", ["call", "meeting", "book", "schedule", "chat"], true, true), c("New inquiry", ["interested", "proposal", "services", "help with"]), c("Existing client", ["project", "update", "deliverable"]), c("Invoice / payment", ["invoice", "payment", "receipt"]), junk],
    urgentKeywords: ["urgent", "asap", "outage", "incident"],
    alwaysEscalate: [...COMMON_ESCALATE, "contract", "agreement", "nda", "payment", "invoice", "discount"],
  },
  other: {
    label: "Something else",
    categories: [c("Booking", ["book", "appointment", "schedule"], true, true), c("Question", ["price", "hours", "how much", "do you"]), junk],
    urgentKeywords: ["emergency", "urgent"],
    alwaysEscalate: COMMON_ESCALATE,
  },
};

export const TIMEZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
] as const;

export function starterProfile(input: { businessName: string; ownerName: string; type: string; timezone: string; phone: string; website: string }): Profile {
  const s = STARTERS[input.type] ?? STARTERS.other;
  const weekday = { open: "09:00", close: "17:00" };
  const first = input.ownerName.split(/\s+/)[0] ?? "";
  const sigLines = [`Thanks,`, input.ownerName ? `${input.ownerName}, ${input.businessName}` : input.businessName, [input.phone, input.website].filter(Boolean).join(" · ")].filter(Boolean);
  return {
    company: { name: input.businessName, ownerName: first, timezone: input.timezone, website: input.website, phone: input.phone, voice: "warm, clear, brief, never pushy" },
    hours: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: null, sun: null },
    scheduling: { slotMinutes: 30, daysAhead: 5, offer: 3 },
    categories: s.categories,
    urgentKeywords: s.urgentKeywords,
    guardList: ["card", "ssn", "password", "bank_account"],
    alwaysEscalate: s.alwaysEscalate,
    approvers: [],
    budget: { monthlyCapUsd: 20, alertPercent: 80 },
    brief: { time: "07:00", radarWeekday: 1 },
    news: { keywords: [], competitors: [] },
    signature: sigLines.join("\n"),
  };
}
