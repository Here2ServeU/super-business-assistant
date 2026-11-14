#!/usr/bin/env python3
"""Super Business Assistant v0.1 — Secure AI. Lower cost.

  python main.py demo          # full flow with sample emails, no accounts needed
  python main.py auth          # connect Gmail + Calendar (opens a browser)
  python main.py telegram-id   # find your Telegram chat id
  python main.py once          # process the inbox one time
  python main.py brief         # send the morning briefing now
  python main.py run           # run continuously (inbox, approvals, 6 a.m. briefing)
"""
import argparse
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from sba.config import load_config
from sba.store import Store


def build(cfg, demo=False):
    from sba.agent import Agent
    from sba.llm import LLM, FakeLLM
    from sba.telegram import ConsoleNotifier, Telegram

    store = Store("demo.db" if demo else "sba.db")
    if demo:
        from sba.demo import FakeCalendar, FakeGmail

        llm = LLM(cfg, store) if cfg["env"]["anthropic_key"] else FakeLLM(cfg, store)
        return Agent(cfg, store, llm, FakeGmail(), FakeCalendar(cfg["business"]["timezone"]), ConsoleNotifier())
    from sba.calendar_client import Calendar
    from sba.gmail_client import Gmail
    from sba.google_auth import get_creds

    if not cfg["env"]["anthropic_key"]:
        sys.exit("Set ANTHROPIC_API_KEY in .env")
    if not (cfg["env"]["telegram_token"] and cfg["env"]["telegram_chat_id"]):
        sys.exit("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env (see README)")
    creds = get_creds()
    return Agent(cfg, store, LLM(cfg, store), Gmail(creds), Calendar(creds, cfg["business"]["timezone"]),
                 Telegram(cfg["env"]["telegram_token"], cfg["env"]["telegram_chat_id"]))


def briefing(agent, with_radar=False, news=None):
    from sba.briefing import build_briefing, fetch_news
    from sba.radar import check_competitors, radar_text, recommendations

    cfg = agent.cfg
    news = news if news is not None else fetch_news(cfg["news"]["keywords"])
    rtxt = ""
    if with_radar:
        try:
            changes = check_competitors(cfg, agent.store)
            rtxt = radar_text(changes, recommendations(cfg, agent.llm, changes, news))
        except Exception as e:
            agent.store.log("radar", "failed", str(e))
    msg = build_briefing(cfg, agent.store, agent.llm, agent.cal, news, rtxt)
    agent.tg.send(msg)
    agent.store.log("agent", "briefing_sent")


def run_forever(agent):
    cfg, store = agent.cfg, agent.store
    tz = ZoneInfo(cfg["business"]["timezone"])
    last_poll = 0
    agent.tg.send(f"👋 {cfg['business']['name']} assistant is running. Send /help for commands.")
    while True:
        for kind, data, cb_id, mid in agent.tg.updates(timeout=20):
            try:
                if kind == "callback":
                    agent.on_callback(data, cb_id, mid)
                elif data.strip().lower() in ("/brief", "brief"):
                    briefing(agent)
                else:
                    agent.on_command(data)
            except Exception as e:
                store.log("error", "owner_action", str(e))
        if time.time() - last_poll >= cfg["gmail"]["poll_seconds"]:
            last_poll = time.time()
            try:
                agent.process_inbox()
            except Exception as e:
                store.log("error", "inbox", str(e))
        now = datetime.now(tz)
        if now.strftime("%H:%M") >= cfg["briefing"]["time"] and store.get("last_brief") != now.date().isoformat():
            store.set("last_brief", now.date().isoformat())
            try:
                briefing(agent, with_radar=now.weekday() == cfg["radar"]["weekday"])
            except Exception as e:
                store.log("error", "briefing", str(e))


def telegram_id(cfg):
    import requests

    tok = cfg["env"]["telegram_token"] or sys.exit("Set TELEGRAM_BOT_TOKEN in .env first, then send your bot any message.")
    r = requests.get(f"https://api.telegram.org/bot{tok}/getUpdates", timeout=20).json()
    chats = {u["message"]["chat"]["id"]: u["message"]["chat"].get("first_name", "") for u in r.get("result", []) if "message" in u}
    print("Chats that messaged your bot:", chats or "none yet: send your bot a message, then run this again.")


def demo(cfg):
    import os

    if os.path.exists("demo.db"):
        os.remove("demo.db")
    agent = build(cfg, demo=True)
    print(f"Demo for {cfg['business']['name']} · AI: {'live Claude' if cfg['env']['anthropic_key'] else 'offline stand-in (set ANTHROPIC_API_KEY for real drafts)'}")
    n = agent.process_inbox()
    print(f"\nProcessed {n} emails.")
    # owner taps ✅ on the first waiting draft
    w = agent.store.waiting()
    if w:
        print(f"\n👆 Owner taps ✅ Send on: {w[0]['subject']}")
        agent.on_callback(f"send:{w[0]['id']}", "cb", w[0]["tg_msg_id"])
    sample_news = [{"title": "Utility announces heat pump rebate program for 2027", "link": "https://example.com"}]
    briefing(agent, news=sample_news)
    spent, calls = agent.store.month_cost()
    print("\n" + "═" * 60)
    print(f"Sent after approval: {len(agent.gmail.sent)} · Drafts waiting: {len(agent.store.waiting())} · AI calls: {calls} · Est. cost: ${spent:.4f}")
    print("Audit log (latest first):")
    for r in agent.store.recent_audit(12):
        print(f"  {r['actor']:>6} · {r['action']:<18} {r['detail'][:70]}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Super Business Assistant")
    p.add_argument("cmd", choices=["demo", "auth", "telegram-id", "once", "brief", "run"])
    p.add_argument("--config", default="config.yaml")
    a = p.parse_args()
    cfg = load_config(a.config)
    if a.cmd == "demo":
        demo(cfg)
    elif a.cmd == "auth":
        from sba.google_auth import get_creds
        get_creds(); print("✅ Gmail and Calendar connected. token.json saved.")
    elif a.cmd == "telegram-id":
        telegram_id(cfg)
    elif a.cmd == "once":
        print("Processed", build(cfg).process_inbox(), "emails.")
    elif a.cmd == "brief":
        briefing(build(cfg), with_radar=True)
    elif a.cmd == "run":
        run_forever(build(cfg))
