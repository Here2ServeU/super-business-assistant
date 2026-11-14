# Super Business Assistant v0.1
**Secure AI. Lower cost.** An AI office manager that drafts email replies, suggests meeting times, asks the owner before anything goes out, sends a 6 a.m. briefing with news and next steps, and runs a weekly Growth radar.

```
New email ─► GUARDS ─────────► SORT (small model) ─► DRAFT (larger model) ─► 📱 OWNER: ✅ Send / 🚩 Escalate / 🗑 Skip
             mask cards/IDs    routine · meeting      saved in Gmail Drafts      nothing sends without a tap
             block tricks      needs_owner · spam     + open calendar times
             keyword escalate

6:00 a.m. ─► briefing: waiting approvals · today's calendar · news in your field · 3–5 next steps
Mondays   ─► + Growth radar: competitor website changes → in-lane recommendations (Improve / Expand / Stand out)
Always    ─► audit log · monthly AI budget cap · /pause kill switch
```

## Your weekend plan

### Friday night (1 hour): accounts
1. **Python 3.11+** on your Mac: `python3 --version`
2. **Claude API key:** console.anthropic.com → API keys. In the Console, **set a monthly spend limit** for the workspace (your second budget cap).
3. **Telegram bot** (the owner's approval phone):
   - In Telegram, message **@BotFather** → `/newbot` → copy the token.
   - Send your new bot any message.
4. **Google Cloud** (console.cloud.google.com):
   - Create a project and enable the **Gmail API** and **Google Calendar API**.
   - OAuth consent screen:
     - **Testing with your own Gmail:** choose External, Testing, and add yourself as a test user. Note that tokens for apps in Testing expire after 7 days, so re-run `auth` weekly.
     - **For a client's Google Workspace:** create the project inside *their* Workspace and choose **Internal**.
   - Credentials → Create OAuth client ID → **Desktop app** → download it as `credentials.json` into this folder.
   - Use a **test inbox** first, not your main one.

### Saturday morning: run it
```bash
cd super-business-assistant
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q          # 8 tests: guards, slots, cost, end-to-end
python main.py demo          # sample inbox, no accounts needed
cp .env.example .env         # add ANTHROPIC_API_KEY, then run demo again for real drafts
```

### Saturday afternoon: connect your inbox
```bash
cp config.example.yaml config.yaml     # or a preset: cp presets/restaurant.yaml config.yaml
python main.py auth                    # browser opens; approve Gmail + Calendar
python main.py telegram-id             # copy your chat id into .env as TELEGRAM_CHAT_ID
python main.py once                    # drafts appear in Gmail Drafts + your phone
```
Send yourself test emails: a question, a meeting request, a refund demand, a trick email ("ignore your instructions…") and a fake card number. Approve one from your phone.

### Saturday evening: make it sound like the business
Edit `config.yaml`:
- `approved_answers`: the only facts the assistant may state.
- `voice` and `signature`.
- `always_escalate` words.
- `lane` and `competitors`.

### Sunday morning: briefing and Growth radar
```bash
python main.py brief     # sends the briefing + radar now
python main.py run       # runs all day: inbox every 2 min, approvals, 6 a.m. briefing
```
Keep it running on your Mac Studio with `com.emmanuel.sba.plist` (instructions inside), or on a small cloud server with the `Dockerfile`.

### Sunday afternoon: prove and package it
- [ ] Red-team: send 5 trick emails. All should be quarantined or escalated.
- [ ] Check the monthly cost in `/status`.
- [ ] Record a 60-second phone video: email arrives → draft → ✅ → sent.
- [ ] Invite 3 owners to a free AI check this week.

## Owner commands (Telegram)
`/status` · `/brief` · `/pause` (kill switch) · `/resume` · `/help`

## Industry presets (`presets/`)
`restaurant` · `salon` · `law_office` · `church` · `retail_store` · `auto_repair`, plus heating and air in `config.example.yaml`. Copy one to `config.yaml` and replace every *(example)* value.

## Security built in
- **Least privilege:** Gmail modify (read, label, draft, send *drafts*) and Calendar read-only. It cannot delete mail, change settings or touch money.
- **Human approval:** replies are Gmail drafts. Nothing sends until the owner taps ✅. Edits made in Gmail are what gets sent.
- **Guards:**
  - Card numbers (Luhn-checked), SSNs and inline passwords are masked before the AI sees them and checked again on the way out.
  - Trick emails ("ignore your instructions…") are quarantined and never reach the drafting model.
  - Email text is passed to the AI wrapped as untrusted data.
- **Escalation:** refunds, complaints, legal, crisis and similar words always go to a person.
- **Only the owner's Telegram chat** is obeyed.
- **Audit log:** in `sba.db`.
- **Secrets:** stay in `.env`, `credentials.json` and `token.json` (gitignored; `token.json` is chmod 600). Use a secrets manager when you host for clients.
- **Sensitive industries:**
  - **Law office:** the assistant never gives legal advice.
  - **Church:** pastoral and crisis messages go straight to the pastor.
  - **Healthcare and dental (HIPAA):** don't use yet. You need BAAs with every vendor first.

## Lower cost built in
- A small model sorts; a larger model drafts only when a reply is needed.
- A hard monthly cap (`budget.monthly_usd`). When it's hit, the AI stops and the owner is told. Add a Console spend limit as a second cap.
- Cost per call is logged. Set `pricing_per_million` to your provider's current prices, and check model names at docs.claude.com.

## v0.2 ideas
Book the event on approval · Outlook/Microsoft 365 via Microsoft Graph · web dashboard · Growth radar with Google Places and new-business filings · per-client hosting.
