# Email Scheduler

Schedule bulk emails like a boss. Sign in with Google, upload your contacts, set up a campaign, and let the system handle the rest. Emails get staggered automatically, you won't hit rate limits, and everything's backed up so nothing gets lost or sent twice.

## Stack

| Part | Tech |
| --- | --- |
| API & Jobs | TypeScript, Express 5, BullMQ (for scheduling), Redis, PostgreSQL |
| Emails | Nodemailer + Ethereal (or your own SMTP) |
| UI | Next.js 16, React 19, Tailwind, Google OAuth |

## The folder layout

```
email-scheduler/
├── docker-compose.yml        # Dev: Postgres + Redis
├── docker-compose.prod.yml   # Prod: full stack with HTTPS
├── Caddyfile                 # Reverse proxy setup
├── DEPLOYMENT.md             # How to deploy (Railway, Vercel, or your own server)
├── backend/                  # API + job worker
└── frontend/                 # Dashboard
```

**Ready to deploy?** Jump to [DEPLOYMENT.md](DEPLOYMENT.md). We cover Railway + Vercel, or running everything on one server with Docker Compose and automatic HTTPS.

**Just want to see it work?** Deploy the frontend folder to Vercel and it'll run in demo mode—everything happens in your browser, no backend needed.

---

## Getting it running locally

### What you need

- Node.js 20+ (tested on 22)
- Docker (or install PostgreSQL 14+ and Redis 6.2+ yourself)

### Fire up the database

```bash
cd email-scheduler
docker compose up -d
```

### Backend

```bash
cd backend
cp .env.example .env        # Fill in GOOGLE_CLIENT_ID and JWT_SECRET
npm install
npm run dev                 # Runs on :4000 with a worker built in
```

The database tables get created automatically. To scale up, separate the API from the worker:

```bash
RUN_WORKER=false npm run dev    # Just the API
npm run dev:worker              # Worker (run this in multiple terminals)
```

Production: `npm run build && npm start`

### Frontend

```bash
cd frontend
cp .env.example .env.local  # Add NEXT_PUBLIC_GOOGLE_CLIENT_ID
npm install
npm run dev                 # Open http://localhost:3000
```

### Sending emails through Ethereal

By default, we create a free Ethereal account for you on first run and reuse it forever. Every email sent gets a preview link you can click to see what it looked like.

Want to use your own provider? Create an Ethereal account at <https://ethereal.email/create>, then set `ETHEREAL_USER` and `ETHEREAL_PASS` in your `.env`.

Running offline? Set `MAIL_MODE=log` and emails just print to the console.

### Setting up Google OAuth

1. Head to Google Cloud Console → APIs & Services → Credentials
2. Create an OAuth client for a web app
3. Add `http://localhost:3000` to Authorized JavaScript Origins
4. Grab your Client ID and put it in:
   - `backend/.env` as `GOOGLE_CLIENT_ID`
   - `frontend/.env.local` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`

The frontend pops up a Google login. The backend verifies it and hands back your own JWT. You can also just sign up with email/password.

---

## How it works

```
Next.js ──────► Express API ──(1) Save campaign & emails in one transaction ──► Database
                     │
                     └──(2) Add delayed jobs ──────► Redis + BullMQ
                                                         │
                             Workers (multiple copies) ◄─┘
                             1. Claim an email (lock it)
                             2. Check hourly limit
                             3. Send via SMTP
                             4. Mark done
```

### The scheduling part

When you create a campaign, we:
1. Save the campaign and all email addresses in one database transaction
2. Space them out by scheduling each one at `startTime + (position × delay)`
3. Push each email to a job queue with that scheduled time
4. Redis wakes up each job at exactly the right moment

No cron, no polling—just Redis doing its thing.

### Stuff doesn't get lost

- **Database is the source of truth**: Every email has a status (`scheduled` → `sending` → `sent` or `failed`)
- **Jobs survive restarts**: BullMQ keeps jobs in Redis, even if you turn off the server
- **Recovery on boot**: Workers check the database when they start and re-queue anything that's still pending
- **Graceful shutdown**: Workers finish what they're doing before exiting

### You'll never send twice

1. Each job's ID is tied to a specific email, so it can't get queued twice
2. Before sending, we lock the database row (`UPDATE ... SET status='sending' WHERE status='scheduled'`)—only one worker can win
3. If a worker crashes while sending, we wait 5 minutes then retry (this is the only way a duplicate could happen)
4. The database prevents the same email from being added to the same campaign twice

### Rate limits & concurrency

| What | Where | Does |
| --- | --- | --- |
| Parallel jobs per worker | BullMQ | How many emails send at the same time on one worker |
| Min gap between emails | Redis limiter | Slowdown between all sends (mimics provider throttling) |
| Delay in campaign | Your UI choice | Space between emails in a single campaign |
| Hourly cap | Redis counter | Max emails per sender per hour |
| Server cap | Config | Upper bound on what you can set in the UI |

The hourly limit uses a Redis script so every worker sees the same count, no matter how many are running.

When you hit the hourly limit, emails get bumped to the next hour—they're not dropped. The dashboard updates in real time with the new send time.

---

## API endpoints

Everything except auth requires `Authorization: Bearer <your_jwt>`.

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/auth/google` | Google sign-in → JWT |
| POST | `/api/auth/register` | Sign up with email/password |
| POST | `/api/auth/login` | Sign in with email/password |
| GET | `/api/auth/me` | Your profile |
| GET | `/api/senders` | Your sender accounts |
| POST | `/api/emails/schedule` | Create a campaign |
| GET | `/api/emails?tab=scheduled\|sent&search=...` | List emails |
| GET | `/api/emails/stats` | Counts (scheduled, sent, failed) |
| GET | `/api/emails/:id` | Email details & preview link |
| PATCH | `/api/emails/:id/star` | Star/unstar an email |
| GET | `/health` | Health check |

---

## What you get in the UI

- **Login**: Google OAuth, or email/password
- **Sidebar**: Your profile, Compose button, and tabs for Scheduled/Sent with live counts
- **Scheduled & Sent tabs**: Full email list with search, filters, status badges, and previews. Refreshes every 5 seconds
- **Email detail**: Sender, recipient, time, body preview, delivery attempts, errors, and a link to the Ethereal preview
- **Compose**:
  - Pick a sender
  - Add recipients (type, paste, or upload a `.csv`/`.txt` file—we'll extract email addresses)
  - Set subject, delay between sends, and hourly limit
  - Rich text editor (formatting, links, lists, quotes)
  - Date/time picker with quick presets (Now, Tomorrow at 10 AM, etc.)
- **Mobile friendly**: Sidebar turns into a drawer on small screens

---

## Configuration

All settings live in `.env.example` files in the `backend` and `frontend` folders. Check them out—each variable is documented inline.
