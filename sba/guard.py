"""Guardrails: run on every email before and after the AI."""
import re

INJECTION = re.compile(
    r"(ignore (all |your |the |any )?(previous |prior |above )?(rules|instructions|prompts?)"
    r"|system prompt|developer mode|jailbreak|you are now|act as (an? )?(admin|developer|system)"
    r"|reveal (your|the) (rules|instructions|prompt)|forward (all|every) (emails?|messages?)"
    r"|send (me )?(all|every) (customer|client|patient|member)s?'? ?(data|records|emails|list)"
    r"|disregard (the|your) (rules|instructions))",
    re.I,
)
CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
SECRET = re.compile(r"(?i)\b(password|passcode|pin|api[_ -]?key)\s*[:=]\s*\S+")


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for d in reversed(digits):
        n = int(d)
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


def mask_pii(text: str):
    """Return (masked_text, count). Masks card numbers, SSNs and inline secrets."""
    count = 0

    def card(m):
        nonlocal count
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19 and _luhn(digits):
            count += 1
            return "[CARD NUMBER REMOVED]"
        return m.group(0)

    def ssn(_):
        nonlocal count
        count += 1
        return "[ID NUMBER REMOVED]"

    def secret(m):
        nonlocal count
        count += 1
        return m.group(1) + ": [REMOVED]"

    text = CARD.sub(card, text)
    text = SSN.sub(ssn, text)
    text = SECRET.sub(secret, text)
    return text, count


def looks_like_injection(text: str) -> bool:
    return bool(INJECTION.search(text or ""))


def must_escalate(text: str, keywords) -> str | None:
    low = (text or "").lower()
    for k in keywords or []:
        if re.search(r"\b" + re.escape(k.lower()) + r"\b", low):
            return k
    return None


def as_untrusted(label: str, text: str, limit: int = 6000) -> str:
    """Wrap outside content so the model treats it as data, never as instructions."""
    clean = (text or "")[:limit].replace("</" + label, "&lt;/" + label)
    return f"<{label}>\n{clean}\n</{label}>"


class BudgetExceeded(Exception):
    pass
