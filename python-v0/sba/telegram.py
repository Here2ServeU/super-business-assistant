"""Telegram bot for owner approvals. Only the owner's chat id is ever obeyed."""
import requests


class Telegram:
    def __init__(self, token, chat_id):
        self.base = f"https://api.telegram.org/bot{token}"
        self.chat_id = str(chat_id)
        self.offset = 0

    def send(self, text, buttons=None):
        data = {"chat_id": self.chat_id, "text": text[:4000], "disable_web_page_preview": True}
        if buttons:
            data["reply_markup"] = {"inline_keyboard": buttons}
        r = requests.post(self.base + "/sendMessage", json=data, timeout=20).json()
        return r.get("result", {}).get("message_id")

    def edit(self, message_id, text):
        requests.post(self.base + "/editMessageText", json={"chat_id": self.chat_id, "message_id": message_id, "text": text[:4000]}, timeout=20)

    def answer(self, callback_id, text=""):
        requests.post(self.base + "/answerCallbackQuery", json={"callback_query_id": callback_id, "text": text}, timeout=20)

    def updates(self, timeout=20):
        """Yield ('callback', data, cb_id, msg_id) or ('command', text, None, None) from the owner only."""
        try:
            r = requests.get(self.base + "/getUpdates", params={"offset": self.offset, "timeout": timeout}, timeout=timeout + 10).json()
        except requests.RequestException:
            return
        for u in r.get("result", []):
            self.offset = u["update_id"] + 1
            if "callback_query" in u:
                cq = u["callback_query"]
                if str(cq["message"]["chat"]["id"]) != self.chat_id:
                    continue
                yield "callback", cq.get("data", ""), cq["id"], cq["message"]["message_id"]
            elif "message" in u and str(u["message"]["chat"]["id"]) == self.chat_id:
                yield "command", u["message"].get("text", ""), None, None


class ConsoleNotifier:
    """Used in demo mode: prints instead of sending."""

    def __init__(self):
        self.sent = []

    def send(self, text, buttons=None):
        self.sent.append(text)
        labels = " | ".join(b["text"] for row in (buttons or []) for b in row)
        print("\n" + "─" * 60 + "\n📱 TO OWNER'S PHONE\n" + text + (f"\n[ {labels} ]" if labels else ""))
        return len(self.sent)

    def edit(self, message_id, text):
        print(f"\n📱 (message {message_id} updated) {text[:120]}")

    def answer(self, *a, **k):
        pass

    def updates(self, timeout=0):
        return iter(())
