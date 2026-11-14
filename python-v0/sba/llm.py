"""Claude wrapper with right-sized models, cost tracking and a hard budget cap."""
import json
import re

from .guard import BudgetExceeded


def cost_usd(cfg, tier, in_tok, out_tok):
    r = cfg["pricing_per_million"][tier]
    return (in_tok * r["input"] + out_tok * r["output"]) / 1_000_000


def parse_json(text):
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=-1)
    end = max(text.rfind("}"), text.rfind("]"))
    if start < 0 or end < start:
        raise ValueError("no JSON in model reply")
    return json.loads(text[start : end + 1])


class LLM:
    def __init__(self, cfg, store):
        self.cfg, self.store = cfg, store
        import anthropic  # lazy import

        self.client = anthropic.Anthropic(api_key=cfg["env"]["anthropic_key"])

    def _check_budget(self):
        spent, _ = self.store.month_cost()
        if spent >= float(self.cfg["budget"]["monthly_usd"]):
            raise BudgetExceeded(f"Monthly AI budget reached (${spent:.2f}).")

    def ask(self, tier, system, user, max_tokens=700):
        self._check_budget()
        resp = self.client.messages.create(
            model=self.cfg["models"][tier],
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        c = cost_usd(self.cfg, tier, resp.usage.input_tokens, resp.usage.output_tokens)
        self.store.add_usage(tier, resp.usage.input_tokens, resp.usage.output_tokens, c)
        return text.strip()

    def ask_json(self, tier, system, user, max_tokens=700):
        text = self.ask(tier, system + "\nReply with only valid JSON, no other text.", user, max_tokens)
        return parse_json(text)


class FakeLLM(LLM):
    """Offline stand-in for demo mode and tests. Same interface, canned answers, estimated cost."""

    def __init__(self, cfg, store):
        self.cfg, self.store = cfg, store

    def ask(self, tier, system, user, max_tokens=700):
        self._check_budget()
        u = user.lower()
        if "classify" in system.lower():
            if "meet" in u or "schedule" in u or "appointment" in u or "come out" in u:
                out = {"category": "meeting", "summary": "Customer wants to book a visit.", "reason": "asks for a time"}
            elif "unsubscribe" in u or "verify your account" in u:
                out = {"category": "spam_or_phishing", "summary": "Looks like phishing.", "reason": "asks to verify account"}
            else:
                out = {"category": "routine", "summary": "Routine customer question.", "reason": "answerable from approved info"}
            text = json.dumps(out)
        elif "recommendation" in system.lower():
            text = json.dumps([
                {"type": "Improve", "title": "Text a 30-minute heads-up with the tech's photo", "why": "Competitor reviews mention missed windows.", "impact": "High", "effort": "Low", "in_lane": True, "first_step": "Set up a text template."},
                {"type": "Expand", "title": "Maintenance plans for property managers", "why": "Same services, steady income.", "impact": "High", "effort": "Medium", "in_lane": True, "first_step": "List 10 local property managers."},
                {"type": "Stand out", "title": "Install solar panels", "why": "Trend in the news.", "impact": "Medium", "effort": "High", "in_lane": False, "first_step": "-"},
            ])
        elif "briefing" in system.lower():
            text = "Top of mind: 2 replies are drafted and waiting. Next steps:\n1. Approve the 2 drafts.\n2. Call back the escalated customer.\n3. Review the competitor's new spring offer."
        else:
            text = "Hi,\n\nThanks for reaching out! " + self.cfg["approved_answers"].get("hours", "") + " A team member will confirm the details shortly.\n\n" + self.cfg["business"]["signature"]
        in_tok, out_tok = len(system + user) // 4, len(text) // 4
        self.store.add_usage(tier, in_tok, out_tok, cost_usd(self.cfg, tier, in_tok, out_tok))
        return text
