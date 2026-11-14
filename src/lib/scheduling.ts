import type { Slot, TenantDb } from "@/lib/dal";
import type { MailProvider } from "@/lib/mail/types";
import { WEEKDAYS, type Profile } from "@/lib/settings";

// Offers open times inside business hours, skipping anything already held or busy.
// Double-booking is ALSO blocked at the database level (exclusion constraint on calendar_holds).

function partsIn(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: (p.weekday as string).toLowerCase().slice(0, 3) };
}

/** Wall-clock time in a timezone -> UTC instant. */
export function zoned(tz: string, y: number, m: number, d: number, h: number, mi: number): Date {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(tz, new Date(guess));
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    guess += Date.UTC(y, m - 1, d, h, mi) - asUtc;
  }
  return new Date(guess);
}

export function localDate(tz: string, d = new Date()) {
  const p = partsIn(tz, d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function localTime(tz: string, d = new Date()) {
  const p = partsIn(tz, d);
  return { hhmm: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`, weekday: p.wd };
}

/** Is the business open right now? Used for after-hours urgency. */
export function isOpen(profile: Profile, at = new Date()) {
  const { hhmm, weekday } = localTime(profile.company.timezone, at);
  const h = profile.hours[weekday as keyof Profile["hours"]];
  return !!h && hhmm >= h.open && hhmm < h.close;
}

const label = (tz: string, d: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

export async function openSlots(db: TenantDb, profile: Profile, provider: MailProvider | null, now = new Date()): Promise<Slot[]> {
  const tz = profile.company.timezone;
  const { slotMinutes, daysAhead, offer } = profile.scheduling;
  const horizon = new Date(now.getTime() + (daysAhead + 1) * 86400_000);
  const held = await db.activeHolds(now, horizon);
  let busy: { start: Date; end: Date }[] = held.map((h) => ({ start: h.starts_at, end: h.ends_at }));
  if (provider) {
    try {
      busy = busy.concat(await provider.busy(now, horizon));
    } catch {
      /* calendar not available: fall back to holds only */
    }
  }
  const earliest = now.getTime() + 2 * 3600_000; // at least 2 hours' notice
  const out: Slot[] = [];
  for (let day = 0; day <= daysAhead && out.length < offer; day++) {
    const p = partsIn(tz, new Date(now.getTime() + day * 86400_000));
    const wd = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
    const hours = profile.hours[wd];
    if (!hours) continue;
    const [oh, om] = hours.open.split(":").map(Number);
    const [ch, cm] = hours.close.split(":").map(Number);
    const open = zoned(tz, p.y, p.m, p.d, oh, om);
    const close = zoned(tz, p.y, p.m, p.d, ch, cm);
    // One offer per day keeps choices spread out.
    for (let s = open.getTime(); s + slotMinutes * 60_000 <= close.getTime(); s += slotMinutes * 60_000) {
      const e = s + slotMinutes * 60_000;
      if (s < earliest) continue;
      if (busy.some((b) => b.start.getTime() < e && b.end.getTime() > s)) continue;
      out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), label: label(tz, new Date(s)) });
      break;
    }
  }
  return out;
}

export function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3600_000);
}
