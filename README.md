# Email Job Scheduler

A full-stack email scheduling service: users log in with Google, upload a list of leads, and schedule
a campaign. The backend spaces out the sends, enforces per-sender hourly limits, and sends through
SMTP (Ethereal). Jobs survive restarts and are never sent twice.

| Layer    | Stack                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Backend  | TypeScript, Express 5, **BullMQ** (delayed jobs, no cron), Redis (ioredis), PostgreSQL, Nodemailer + Ethereal |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Google OAuth (`@react-oauth/google`)           |

```
email-scheduler/
├── docker-compose.yml   # Postgres + Redis (AOF persistence)
├── backend/             # API + BullMQ worker
└── frontend/            # Next.js dashboard
```

---

## 1. Running it locally

### Prerequisites

- Node.js 20+ (tested on 22)
- Docker (for Postgres and Redis), or local installs of PostgreSQL 14+ and Redis 6.2+

### Start Redis and Postgres

```bash
cd email-scheduler
docker compose up -d
```

### Backend

```bash
cd backend
cp .env.example .env        # then fill in GOOGLE_CLIENT_ID and JWT_SECRET
npm install
npm run dev                 # API on :4000 with an embedded worker
```

The schema is created automatically on boot. To scale sending, run the API without a worker and start
as many workers as you like:

```bash
RUN_WORKER=false npm run dev    # API only
npm run dev:worker              # run this in N terminals / containers
```

For production: `npm run build && npm start` (API + worker) or `npm run start:worker`.

### Frontend

```bash
cd frontend
cp .env.example .env.local  # set NEXT_PUBLIC_GOOGLE_CLIENT_ID
npm install
npm run dev                 # http://localhost:3000
```

### Ethereal (fake SMTP)

Nothing to do by default: on first boot the backend creates an Ethereal account through Nodemailer
and saves it in the `senders` table, so it stays the same across restarts. To use your own account,
create one at <https://ethereal.email/create> and set `ETHEREAL_USER` / `ETHEREAL_PASS`.
Every sent email stores an Ethereal **preview URL**, linked from the email detail page.

For offline development, `MAIL_MODE=log` skips SMTP and just logs each message.

### Google OAuth

1. In Google Cloud Console, go to **APIs & Services → Credentials → Create OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add `http://localhost:3000`.
3. Put the client ID in both `backend/.env` (`GOOGLE_CLIENT_ID`) and `frontend/.env.local`
   (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`).

The frontend gets a Google access token through the OAuth popup. The backend checks it with Google's
`tokeninfo` endpoint, rejecting it unless it was issued to **our** client ID, then reads the
profile (name, email, avatar) and returns its own JWT. Email/password sign-up is also available.

---

## 2. Architecture

```
 Next.js ──REST──► Express API ──(1) INSERT campaign + emails (1 tx)──► PostgreSQL  (source of truth)
                        │
                        └──(2) addBulk delayed jobs, jobId = email.id ──► Redis / BullMQ
                                                                             │
                              ┌──────────────── Worker(s), concurrency N ◄───┘
                              │  a. atomically claim row (scheduled → sending)
                              │  b. Redis hourly-slot check for the sender (Lua, atomic)
                              │  c. send via SMTP → mark sent (+ preview URL)
                              └──────────────────────────────────────────────────►  Ethereal SMTP
```

### How scheduling works

`POST /api/emails/schedule` normalises and de-duplicates recipients, then in **one transaction**
inserts a `campaigns` row and one `emails` row per recipient. Email `i` is scheduled at
`startAt + i × delayBetweenEmails`. After the commit, each email gets a **BullMQ delayed job**
(`delay = scheduled_at − now`). No cron and no polling: Redis wakes the job at the right time.

### Persistence across restarts

- **Postgres is the source of truth.** Every email row has a status:
  `scheduled → sending → sent | failed`.
- **BullMQ jobs live in Redis.** Delayed jobs survive an API or worker restart. With AOF enabled
  (see `docker-compose.yml`), they also survive a Redis restart.
- **Recovery on boot.** Every worker process re-enqueues all rows still `scheduled` or `sending`.
  Because `jobId = email.id`, BullMQ ignores jobs that already exist and only recreates missing
  ones. So even a fully wiped Redis, or a crash between the DB commit and the enqueue, loses nothing.
  (Tested: flushed Redis with pending emails, restarted, and all of them were re-queued.)
- **Graceful shutdown.** On SIGINT/SIGTERM, workers finish in-flight jobs before exiting.

### No duplicate sends (idempotency)

1. `jobId = email.id`, so the same email can only be queued once.
2. Before sending, the worker **claims** the row with one conditional
   `UPDATE … SET status='sending' WHERE status='scheduled'`. Only one worker can win, however many
   are running. Anything already `sent` or `failed` is skipped.
3. A row left in `sending` by a crashed worker becomes claimable again after 5 minutes.
   This is the only case where a duplicate is possible: SMTP accepted the message but the process
   died before recording it. No SMTP provider can rule that out.
4. `UNIQUE (campaign_id, to_email)` stops the same address appearing twice in a campaign.

Tested with 3 processes sending 30 emails at once: exactly 30 sends, no duplicates.

### Rate limiting and concurrency

| Setting                                    | Where                                     | What it does                                                                                                       |
| ------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `WORKER_CONCURRENCY` (default 5)           | BullMQ `Worker` option                    | Jobs processed in parallel **per worker process**                                                                  |
| `MIN_DELAY_BETWEEN_EMAILS_MS` (default 2000) | BullMQ `limiter { max: 1, duration }`   | Minimum gap between any two sends, **across all workers**. It mimics provider throttling and is stored in Redis.   |
| Delay between 2 emails (UI)                | `scheduled_at` spacing                    | Spaces out the emails within one campaign                                                                          |
| Hourly Limit (UI)                          | Redis counter per sender per hour window  | Maximum sends per sender per hour                                                                                  |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` (default 200) | server cap                            | Upper bound on the UI hourly limit                                                                                 |

**The hourly limit is shared safely across workers.** Each send runs a small Lua script against
`ratelimit:sender:{senderId}:{hourWindow}` that increments and checks the counter in a single
atomic step, so any number of workers or machines share the same count.

**When the limit is reached, emails are rescheduled, not dropped.** The job is moved back to
BullMQ's delayed set (`moveToDelayed` + `DelayedError`, which does not count as a failed attempt),
and the row's `scheduled_at` is set to the start of the **next hour window**. The dashboard shows
the new time. Each overflowing email takes a numbered ticket for that window and is offset by
`ticket × MIN_DELAY`, so deferred emails keep their original order and don't all fire at `hh:00:00`.

**Failures are retried.** SMTP errors retry 3 times with exponential backoff (30s, 60s, 120s).
After the last attempt the email is marked `failed` and the error is saved.

---

## 3. API

All routes except auth need `Authorization: Bearer <jwt>`.

| Method | Path                         | Description                                                                                                |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/google`           | `{ accessToken }` or `{ credential }` (ID token) → `{ token, user }`                                       |
| POST   | `/api/auth/register`         | `{ email, password, name? }` → `{ token, user }`                                                           |
| POST   | `/api/auth/login`            | `{ email, password }` → `{ token, user }`                                                                  |
| GET    | `/api/auth/me`               | current user                                                                                               |
| GET    | `/api/senders`               | sender mailboxes for the "From" dropdown                                                                   |
| POST   | `/api/emails/schedule`       | `{ senderId, subject, body(html), recipients[], startAt, delayBetweenEmailsMs, hourlyLimit }`              |
| GET    | `/api/emails?tab=scheduled\|sent&search=&limit=&offset=` | list for the dashboard tabs                                                    |
| GET    | `/api/emails/stats`          | `{ scheduled, sent, failed }` counts for the sidebar                                                       |
| GET    | `/api/emails/:id`            | email detail (status, attempts, error, Ethereal preview URL)                                               |
| PATCH  | `/api/emails/:id/star`       | `{ starred }`                                                                                              |
| GET    | `/health`                    | liveness                                                                                                   |

---

## 4. Frontend features

- **Login**: "Login with Google" (real OAuth), plus email/password sign-up and sign-in.
- **Sidebar**: user avatar, name and email, with a logout menu; a **Compose** button; and
  **Scheduled** / **Sent** links with live counts.
- **Scheduled / Sent lists**: `To:`, a status pill (orange with the send time when scheduled, grey
  "Sent", red "Failed"), subject, body preview and a star. Includes search, a starred filter,
  refresh, loading skeletons and empty states. The lists poll every 5s, so emails move from
  Scheduled to Sent without a reload.
- **Email detail**: sender, recipient, time, rendered body, delivery attempts, last error, and a
  link to the Ethereal preview.
- **Compose New Email**:
  - "From" picks a sender.
  - "To" takes chips (type, paste or press Enter). **Upload List** reads a `.csv` or `.txt` file,
    pulls out every email address and shows "N emails detected".
  - Subject, **Delay between 2 emails** (seconds), and **Hourly Limit**.
  - Rich-text editor: undo/redo, heading, bold/italic/underline, alignment, lists, quote,
    strikethrough, link and clear formatting.
  - **Send Later** popover: a date-time picker plus presets (Now, Tomorrow, Tomorrow 10:00 AM /
    11:00 AM / 3:00 PM), with Cancel and Done.
- Responsive layout: on mobile the sidebar becomes a slide-out drawer.

## 5. Configuration reference

See `backend/.env.example` and `frontend/.env.example`. Every variable is documented inline.
