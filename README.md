# Super Business Assistant

**Secure AI. Lower cost.** A multi-tenant AI office manager for small businesses. It reads a company's inbox, guards sensitive data, sorts mail, drafts replies using only that company's private knowledge base, and holds every draft in an approval tray. **Nothing is ever sent without a human approving it.**

It also writes a daily brief that ends in 3–5 next steps, runs a weekly growth radar, meters every AI call against a monthly budget cap, can be paused instantly with `/pause`, and writes every action to an audit logbook.

> The original single-business Python version (Telegram approvals, v0.1) lives in [`python-v0/`](python-v0/). Its guard rules were ported into `src/lib/guard.ts`.

## How one email moves through the system

```
Intake ─► Guard ─► Sort ─► Draft from the Cabinet ─► Approval tray ─► Send (only from Approve)
 (Gmail /  mask card,  small    tenant KB only;            Approve /        + calendar hold
  demo)    SSN, pw,    model    no fact without a          Edit & approve / for offered times
           bank #      + rules  source → "let me check"    Escalate / Reject
                                + escalate
Every step ─► Logbook (who, what, when, which tenant)      Every AI call ─► Meter (model, task, cost)
```

## The non-negotiables, and where each one is enforced

| Rule | Where | Proof |
|---|---|---|
| No auto-send | `src/lib/approvals.ts` is the only caller of `provider.send()`. It records the approval first, then mints an `ApprovalProof`. Every provider's `send` re-checks that proof in the database (`verifyProof`), and refuses while paused or in shadow mode. Each send first claims a row in `sent_messages` (unique per draft), so concurrent approvals can't both send. A failed send can be retried by a human. A send whose outcome is unknown is never retried automatically. | `tests/no-auto-send.test.ts` greps the source tree; `tests/e2e.test.ts` covers approve, edit, reject, a draft left sitting, a crash mid-send and double clicks |
| Tenant isolation | Every table has `tenant_id`. All app queries go through `tenantDb(tenantId)` in `src/lib/dal`, which puts `tenant_id` into every WHERE and INSERT. | `tests/architecture.test.ts` (only the DAL touches the DB; every tenant query names `tenant_id`) and the e2e isolation test |
| Guard first | `guard()` runs at intake, before anything is stored, shown, logged or sent to a model. The logbook masks again on write, and outgoing replies are guarded again. | e2e test scans every table for the seeded card number and SSN |
| Cabinet rule | The model may only use retrieved KB passages. After drafting, `checkFacts()` rejects any price, number, phone, link or email not found in the cited sources. If a fact is missing, the reply becomes "let me check" and is escalated. | `tests/cabinet.test.ts` and the e2e unanswerable-question test |
| Injection defense | Email text is wrapped as `<email>` data, never instructions. Suspected injections skip the drafting model entirely: they get a neutral holding reply and go to a person. | e2e injection-trap test |
| Logbook | `audit_log`: intake, guard actions, sort, draft, approval, edit, escalation, send, shadow "would have sent", pause and resume. | Logbook screen (searchable) |
| Meter | `runAi()` checks the cap before each call and records model, task, tokens and cost after it. It alerts once at 80% (configurable). At the cap, drafting stops, mail waits with `waiting_budget`, and sorting falls back to free keyword rules. | e2e budget test |
| /pause | Tenant-level `paused` flag, checked at intake, before every message and inside the send path. Resume never sends anything; drafts still need approval. | e2e pause test (the neighbouring tenant keeps working) |
| Secrets | Only in env vars / Vercel settings. OAuth tokens are encrypted with AES-256-GCM (`src/lib/crypto.ts`). `.env*` is gitignored. | `.env.example` |

**Shadow mode** (per tenant): drafts are created and shown, the send action is off everywhere, and approvals log `shadow: would have sent …`. Client Zero starts in shadow mode.

## Stack

- Next.js 16 (App Router, TypeScript strict) on Vercel
- Postgres + pgvector (Neon in production). Migrations live in `db/migrations`.
- Email + password auth (bcrypt, signed HTTP-only session cookie). Roles per tenant: owner, approver, viewer.
- Gmail via OAuth with least-privilege scopes (read, compose, send, own-calendar events, free/busy). Microsoft 365 is a stub behind the same `MailProvider` interface.
- AI gateway (`src/lib/ai/gateway.ts`) with two routes. SMALL = `claude-haiku-5-5` (sorting, simple drafts, summaries). LARGE = `claude-opus-5-5` (long or multi-question drafts), with server-side refusal fallback enabled. Structured JSON output is validated with zod. Without `ANTHROPIC_API_KEY` it runs a free, deterministic offline model, which is also metered at $0.
- Embeddings: a local 256-dim feature-hashing model stored in pgvector. It needs no key, has no per-call cost, and no KB text leaves the server. A hosted embedding model can replace `embed()` later.
- Vercel Cron: `/api/cron/tick` hourly. It processes each tenant's mail, then makes the daily brief once the tenant's local brief time has passed (plus the radar on the radar weekday).
- Notifications: an in-app logbook ping, plus email through Resend when `RESEND_API_KEY` is set. Channels plug into `src/lib/notify.ts`, so SMS or WhatsApp can be added without touching the pipeline.

## Screens

Dashboard (counts, pillar status, budget meter, `/pause` box) · **Approval tray** (mobile-first: original email, draft, cabinet sources, offered times, Approve / Edit / Escalate / Reject) · Inbox (sorted, flagged) · Briefs (daily + radar archive) · Cabinet (KB upload) · Logbook (search) · Settings (full client profile, mailbox, shadow mode, people).

## Run it locally

```bash
docker run -d --name sba-pg -e POSTGRES_USER=sba -e POSTGRES_PASSWORD=sba -e POSTGRES_DB=sba -p 54329:5432 pgvector/pgvector:pg17
cp .env.example .env     # set DATABASE_URL=postgres://sba:sba@localhost:54329/sba, AUTH_SECRET, ENCRYPTION_KEY, SEED_* logins
npm install
npm run seed             # migrates, seeds North Star (demo) + Client Zero (shadow mode), creates logins
npm run dev              # http://localhost:3000
```

## Test pack

```bash
psql postgres://sba:sba@localhost:54329/sba -c "create database sba_test"   # once
npm test
```

44 tests, using a real Postgres and the North Star demo tenant. They cover the guard, the cabinet rule, architecture (DAL-only DB access), no-auto-send (source grep), intake/sort, masking in every table, the injection trap, "let me check" escalation, Spanish replies and messy threads. They also cover the send cases: approve sends once, edit sends only the edited text, reject and escalate send nothing, a draft left sitting sends nothing, a crash mid-send sends nothing until a human retries, four simultaneous approvals send once, a send with an unknown outcome is never retried, and viewers can't approve. Shadow mode, scheduling without double-booking (also refused by a Postgres exclusion constraint), the meter, the 80% alert and cap, pause/resume isolation, tenant isolation and the daily brief's 3–5 steps are tested too.

## Onboard a new tenant

1. Copy `onboarding/template.json` to `onboarding/<business>.json` and fill it in: company basics, hours, categories (`reply`, `scheduling`), urgent words, guard list, always-escalate words, approvers, budget cap and alert %, brief time, radar weekday, news keywords, competitors, signature, and the KB documents (the only facts the assistant may state). New tenants should start with `"shadowMode": true`.
2. `npm run onboard -- onboarding/<business>.json` (against the production `DATABASE_URL`). The command never overwrites an existing tenant.
3. Add people: create the user and membership (see `scripts/seed.ts` for the two calls), or extend the seed.
4. The owner signs in and goes to **Settings → Connect Gmail**, then watches the tray in shadow mode for a week. When they're happy, they turn shadow mode off.

Example profiles: `onboarding/north-star.json` (demo) and `onboarding/client-zero.json` (Emmanuel's pilot). Six more industry presets (restaurant, salon, law office, church, retail, auto repair) are in `python-v0/presets/` and can be converted to this format.

## Deploy (Vercel)

- Production branch `main`; the build runs `npm run vercel-build` (migrations, then `next build`).
- Env vars: see `.env.example`. Health check: `/health` (app + database + pgvector).
- Gmail: in Google Cloud, create an OAuth client of type **Web application** with redirect URI `https://<APP_URL>/api/mail/google/callback`. Enable the Gmail and Calendar APIs and add the scopes listed in `src/lib/mail/providers.ts`.

## Defaults chosen (change in Settings or the onboarding file)

- Client Zero hours are Mon–Fri 9:00–17:00 Central (not given in the brief). The KB lists the services you named, and anything about price beyond "from $5,000" and "$45/mo" escalates.
- Junk and Personal never get drafts. Client Zero always escalates invoice/payment, contract, legal, medical and employer/conflict topics, plus angry senders.
- Offered appointment times: one per day, 2 hours' notice minimum, inside business hours, skipping holds and Google busy times.
- The monthly budget resets on the 1st (UTC).
