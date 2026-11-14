"""Gmail: read new mail, create reply DRAFTS, label, and send a draft only after approval."""
import base64
from email.mime.text import MIMEText

from bs4 import BeautifulSoup

PROCESSED, NEEDS_OWNER, QUARANTINE = "SBA-Processed", "SBA-Needs-Owner", "SBA-Quarantine"


class Gmail:
    def __init__(self, creds):
        from googleapiclient.discovery import build

        self.svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
        self.labels = {n: self._ensure_label(n) for n in (PROCESSED, NEEDS_OWNER, QUARANTINE)}
        self.me = self.svc.users().getProfile(userId="me").execute()["emailAddress"]

    def _ensure_label(self, name):
        for l in self.svc.users().labels().list(userId="me").execute().get("labels", []):
            if l["name"] == name:
                return l["id"]
        return self.svc.users().labels().create(userId="me", body={"name": name}).execute()["id"]

    def list_new(self, query, max_n):
        q = f"{query} -label:{PROCESSED}"
        res = self.svc.users().messages().list(userId="me", q=q, maxResults=max_n).execute()
        return [m["id"] for m in res.get("messages", [])]

    def get(self, msg_id):
        m = self.svc.users().messages().get(userId="me", id=msg_id, format="full").execute()
        h = {x["name"].lower(): x["value"] for x in m["payload"].get("headers", [])}
        return {
            "id": msg_id,
            "thread_id": m["threadId"],
            "from": h.get("from", ""),
            "reply_to": h.get("reply-to") or h.get("from", ""),
            "subject": h.get("subject", "(no subject)"),
            "message_id": h.get("message-id", ""),
            "body": _body(m["payload"]) or m.get("snippet", ""),
        }

    def label(self, msg_id, *names):
        ids = [self.labels[n] for n in names]
        self.svc.users().messages().modify(userId="me", id=msg_id, body={"addLabelIds": ids}).execute()

    def create_draft(self, email, body_text):
        msg = MIMEText(body_text)
        msg["To"] = email["reply_to"]
        subj = email["subject"]
        msg["Subject"] = subj if subj.lower().startswith("re:") else "Re: " + subj
        if email["message_id"]:
            msg["In-Reply-To"] = email["message_id"]
            msg["References"] = email["message_id"]
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        d = self.svc.users().drafts().create(userId="me", body={"message": {"raw": raw, "threadId": email["thread_id"]}}).execute()
        return d["id"]

    def send_draft(self, draft_id):
        return self.svc.users().drafts().send(userId="me", body={"id": draft_id}).execute()

    def draft_text(self, draft_id):
        d = self.svc.users().drafts().get(userId="me", id=draft_id, format="full").execute()
        return _body(d["message"]["payload"])


def _decode(data):
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")


def _body(payload):
    """Prefer text/plain; fall back to stripped HTML."""
    plain, html = [], []

    def walk(p):
        mt, data = p.get("mimeType", ""), p.get("body", {}).get("data")
        if data and mt == "text/plain":
            plain.append(_decode(data))
        elif data and mt == "text/html":
            html.append(_decode(data))
        for c in p.get("parts", []) or []:
            walk(c)

    walk(payload)
    if plain:
        return "\n".join(plain)
    if html:
        return BeautifulSoup("\n".join(html), "html.parser").get_text("\n")
    return ""
