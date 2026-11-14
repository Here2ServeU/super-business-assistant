"""Calendar: find open slots (pure function, easy to test) and list today's events."""
from datetime import datetime, timedelta, time as dtime
from zoneinfo import ZoneInfo


def find_slots(busy, now, tz, work_start="08:00", work_end="17:00", slot_minutes=30, days_ahead=5, want=3):
    """busy: list of (start, end) aware datetimes. Returns up to `want` slots, max one per day."""
    zone = ZoneInfo(tz)
    ws, we = [dtime.fromisoformat(x) for x in (work_start, work_end)]
    step = timedelta(minutes=slot_minutes)
    out, day = [], (now.astimezone(zone) + timedelta(days=1)).date()
    checked = 0
    while len(out) < want and checked < days_ahead * 2 + 7:
        checked += 1
        if day.weekday() < 5:
            t = datetime.combine(day, ws, zone)
            end_of_day = datetime.combine(day, we, zone)
            while t + step <= end_of_day:
                if all(not (t < b_end and t + step > b_start) for b_start, b_end in busy):
                    out.append(t)
                    break
                t += step
        day += timedelta(days=1)
    return out


def fmt_slot(t):
    return t.strftime("%a %b %-d at %-I:%M %p").replace(":00 ", " ")


class Calendar:
    def __init__(self, creds, tz):
        from googleapiclient.discovery import build

        self.svc = build("calendar", "v3", credentials=creds, cache_discovery=False)
        self.tz = tz

    def busy(self, days_ahead):
        now = datetime.now(ZoneInfo(self.tz))
        body = {"timeMin": now.isoformat(), "timeMax": (now + timedelta(days=days_ahead + 3)).isoformat(), "timeZone": self.tz, "items": [{"id": "primary"}]}
        res = self.svc.freebusy().query(body=body).execute()
        return [(datetime.fromisoformat(b["start"].replace("Z", "+00:00")), datetime.fromisoformat(b["end"].replace("Z", "+00:00"))) for b in res["calendars"]["primary"]["busy"]]

    def today(self):
        zone = ZoneInfo(self.tz)
        start = datetime.now(zone).replace(hour=0, minute=0, second=0, microsecond=0)
        res = self.svc.events().list(calendarId="primary", timeMin=start.isoformat(), timeMax=(start + timedelta(days=1)).isoformat(), singleEvents=True, orderBy="startTime").execute()
        out = []
        for e in res.get("items", []):
            s = e["start"].get("dateTime") or e["start"].get("date")
            out.append(f"{s[11:16] if 'T' in s else 'All day'} {e.get('summary', '(busy)')}")
        return out
