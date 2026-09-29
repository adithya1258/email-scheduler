# Deployment Guide

This guide takes the Email Job Scheduler from this repository to a live URL.

There are two ways to host it permanently, plus a quick option for sharing a link from your own
computer. Pick one:

> **Just want a public link with no backend at all?** Use
> **[Option D: Vercel only (frontend demo mode)](#option-d-vercel-only-frontend-demo-mode)**.
> The scheduler runs inside the visitor's browser, and deploying takes about 2 minutes.
>
> **Just want a link fast, and you have Docker installed?** Use
> **[Option C: your own computer + a Cloudflare quick tunnel](#option-c-your-own-computer--a-public-link-cloudflare-quick-tunnel)**.
> It needs no accounts, credentials or domain and takes about 10 minutes. The link only works
> while your computer is on and Docker is running.

|                    | **Option A: Railway + Vercel** (easiest)                           | **Option B: Your own server (VPS)**                                   |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Where things run   | Backend, PostgreSQL and Redis on Railway; frontend on Vercel        | Everything on one Linux server with Docker Compose                    |
| Skill needed       | Clicking through dashboards                                        | Basic SSH / terminal use                                              |
| Domain needed      | No (you get `*.up.railway.app` and `*.vercel.app` URLs)             | Yes (any domain or subdomain you control)                             |
| HTTPS              | Automatic                                                          | Automatic (Caddy + Let's Encrypt)                                     |
| Cost (roughly)     | Railway usage-based (a few $/month); Vercel Hobby is free          | From about $5/month for a 2 GB VPS                                    |
| Sending real SMTP  | Depends on the Railway plan (see [SMTP note](#a-note-on-smtp-ports)) | Usually works (port 587)                                              |

Both options need **Step 1 (Google OAuth)** first.

> **Why the backend can't go on Vercel:** the backend runs a BullMQ **worker** that must stay
> running to send emails when their time comes. Serverless platforms (Vercel, Netlify functions)
> shut processes down between requests, so the worker would never run. The backend needs an
> always-on host, like Railway or a VPS.

---

## Contents

1. [Step 1: Create Google OAuth credentials](#step-1-create-google-oauth-credentials)
2. [Option A: Railway (backend) + Vercel (frontend)](#option-a-railway-backend--vercel-frontend)
3. [Option B: Single server with Docker Compose](#option-b-single-server-vps-with-docker-compose)
4. [Option C: Your own computer + a public link](#option-c-your-own-computer--a-public-link-cloudflare-quick-tunnel)
5. [Option D: Vercel only (frontend demo mode)](#option-d-vercel-only-frontend-demo-mode)
6. [Ethereal: viewing the emails you send](#ethereal-viewing-the-emails-you-send)
7. [Checking the deployment works](#checking-the-deployment-works)
8. [Troubleshooting](#troubleshooting)
9. [Environment variable reference](#environment-variable-reference)

---

## Step 1: Create Google OAuth credentials

Google login needs an OAuth **Client ID**. You'll paste it into both the backend and the frontend.

1. Open <https://console.cloud.google.com/> and sign in.
2. Use the project picker (top-left) to choose **New Project**, name it (e.g. `email-scheduler`),
   and click **Create**. Make sure it's selected.
3. Go to **APIs & Services → OAuth consent screen**. Newer consoles call this
   **Google Auth Platform**; click **Get started** there.
   - App name: `Email Scheduler`; User support email: your email.
   - Audience / User type: **External**.
   - Contact email: your email. Save.
   - Under **Audience → Test users**, click **Add users** and add every Google account that should
     be able to log in while the app is in *Testing* mode (your own, reviewers', and so on).
     To let *anyone* log in, click **Publish app** instead. The app only asks for the basic
     `openid email profile` scopes, so Google doesn't require a review.
4. Go to **APIs & Services → Credentials → + Create credentials → OAuth client ID**.
   Newer consoles call this **Clients → Create client**.
   - Application type: **Web application**
   - Name: `email-scheduler-web`
   - **Authorized JavaScript origins**: add each URL the frontend is served from, with no
     trailing slash:
     - `http://localhost:3000` (local development)
     - your production frontend URL, e.g. `https://email-scheduler.vercel.app` (Option A)
       or `https://scheduler.yourdomain.com` (Option B)
   - **Authorized redirect URIs**: leave empty. The app uses the popup flow.
   - Click **Create**.
5. Copy the **Client ID**. It looks like `1234567890-abc...apps.googleusercontent.com`.
   You don't need the client secret.

> You can add the production URL to the *Authorized JavaScript origins* later, once you know it.
> Google can take a few minutes to apply the change.

---

## Option A: Railway (backend) + Vercel (frontend)

### A1. Deploy the backend, PostgreSQL and Redis on Railway

1. Sign up at <https://railway.com> with your GitHub account.
2. Click **New Project → Deploy from GitHub repo** and choose `adithya1258/email-scheduler`.
   If the repo isn't listed, click **Configure GitHub App** and grant Railway access to it.
3. Railway creates a service from the repo. Open it, go to **Settings**, and set:
   - **Source → Root Directory**: `/backend`
     Railway then finds `backend/Dockerfile` and builds with it automatically.
   - **Deploy → Healthcheck Path**: `/health`
   - Rename the service to `backend` (optional, but makes things clearer).
4. Add the databases. In the project canvas, click **+ Create** (or **+ New**):
   - **Database → Add PostgreSQL**. This creates a service named `Postgres`.
   - **Database → Add Redis**. This creates a service named `Redis`.
5. Open the **backend** service → **Variables** → **Raw Editor**, and paste the following,
   replacing the `<...>` values:

   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   JWT_SECRET=<a long random string, e.g. output of: openssl rand -hex 32>
   GOOGLE_CLIENT_ID=<your client id from Step 1>
   CORS_ORIGIN=https://<your-frontend>.vercel.app
   MAIL_MODE=ethereal
   RUN_WORKER=true
   WORKER_CONCURRENCY=5
   MIN_DELAY_BETWEEN_EMAILS_MS=2000
   MAX_EMAILS_PER_HOUR_PER_SENDER=200
   ```

   - `${{Postgres.DATABASE_URL}}` and `${{Redis.REDIS_URL}}` are Railway *references*. Railway
     fills in the real connection strings over its private network. If you renamed the database
     services, use the new names.
   - You don't know the Vercel URL yet. Put `http://localhost:3000` for now and update it in A3.
   - Don't set `PORT`. Railway sets it automatically and the app reads it.
6. Click **Deploy** (or **Apply changes**). Watch **Deployments → View logs**. A healthy start
   looks like this:

   ```
   [mailer] created Ethereal account xxxx@ethereal.email (login at https://ethereal.email)
   [worker] started: concurrency=5, min gap=2000ms, max/hour/sender=200, mail mode=ethereal
   [api] listening on http://localhost:8080
   [recovery] ensured 0 pending email job(s) are queued
   ```

   The database tables are created automatically on first start.
7. Make it public: **Settings → Networking → Public Networking → Generate Domain**.
   You'll get something like `https://backend-production-1a2b.up.railway.app`.
8. Test it: open `https://<your-backend>.up.railway.app/health` in a browser. It should show
   `{"ok":true}`.

> **Scaling (optional):** to run workers separately from the API, set `RUN_WORKER=false` on the
> `backend` service. Then add a second service from the same repo (Root Directory `/backend`, same
> variables) with **Settings → Deploy → Custom Start Command** set to `node dist/worker.js` and no
> public domain. Add as many worker services or replicas as you need. The rate limits and
> "never send twice" guarantees are shared through Redis and Postgres.

### A2. Deploy the frontend on Vercel

1. Sign up at <https://vercel.com> with GitHub.
2. Click **Add New… → Project**, find `adithya1258/email-scheduler`, and click **Import**.
3. Configure the project:
   - **Root Directory**: click **Edit** and choose `frontend`.
   - **Framework Preset**: Next.js (detected automatically).
   - Leave the build and output settings at their defaults.
   - **Environment Variables**: add

     | Name                           | Value                                            |
     | ------------------------------ | ------------------------------------------------ |
     | `NEXT_PUBLIC_API_URL`          | `https://<your-backend>.up.railway.app` (no trailing slash) |
     | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | your client ID from Step 1                        |

4. Click **Deploy**. After about a minute you get a URL like `https://email-scheduler-xyz.vercel.app`.
   You can change it under **Settings → Domains**.

> `NEXT_PUBLIC_*` variables are **built into the JavaScript bundle** when the frontend is built.
> If you change them later, open **Deployments → ⋯ → Redeploy**. Just saving them isn't enough.

### A3. Connect the two

1. **Railway → backend → Variables**: set `CORS_ORIGIN` to your exact Vercel URL, e.g.
   `https://email-scheduler-xyz.vercel.app`. Use no trailing slash; separate several URLs with commas.
   Railway redeploys automatically.
2. **Google Cloud → Credentials → your OAuth client**: add the Vercel URL to
   **Authorized JavaScript origins** and save.
3. Open the Vercel URL and follow [Checking the deployment works](#checking-the-deployment-works).

### A note on SMTP ports

Ethereal receives mail over SMTP on port **587**. Some hosting platforms block outgoing SMTP on
free, trial or entry-level plans to fight spam. Railway and Render have both done this on their
lower tiers. Policies change, so check your platform's current documentation.

If emails stay **Scheduled** and eventually show **Failed** with an error like
`Connection timeout` / `ETIMEDOUT`, outbound SMTP is blocked. Your choices:

- upgrade the plan to one that allows SMTP,
- move the backend to a VPS (Option B), where port 587 is almost always open, or
- for a demo, set `MAIL_MODE=log`. Everything works end to end, but emails are logged instead of
  being delivered to Ethereal.

---

## Option B: Single server (VPS) with Docker Compose

This runs PostgreSQL, Redis, the backend, the frontend, and **Caddy** (a web server that gets
free HTTPS certificates automatically) on one machine, all under **one domain**:

```
https://scheduler.yourdomain.com/        → frontend (Next.js)
https://scheduler.yourdomain.com/api/*   → backend  (Express + worker)
```

The files used are `docker-compose.prod.yml`, `Caddyfile`, `.env.prod.example`, and the two
`Dockerfile`s. This whole stack has been built and tested end to end, including restarting Redis
and the backend while an email was scheduled.

### B1. Get a server

Any provider works: Hetzner, DigitalOcean, Vultr, Linode, AWS Lightsail, Oracle Cloud Free Tier, and so on.

- **OS:** Ubuntu 24.04 LTS
- **Size:** **2 GB RAM** or more. Building the Next.js frontend needs memory; on 1 GB add swap
  (see B3).
- Note the server's **public IPv4 address**.

### B2. Point your domain at it

At your domain registrar or DNS provider (Cloudflare, Namecheap, GoDaddy, and so on), create an **A record**:

| Type | Name        | Value             |
| ---- | ----------- | ----------------- |
| A    | `scheduler` | `<server IPv4>`   |

That gives you `scheduler.yourdomain.com`; use `@` for the bare domain. If you use Cloudflare,
set the record to **DNS only** (grey cloud) at first so Caddy can get its certificate.
Wait until `ping scheduler.yourdomain.com` shows your server's IP.

### B3. Prepare the server

SSH in (`ssh root@<server-ip>`), then:

```bash
# Updates + Docker (official install script, includes the compose plugin)
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh

# Firewall: SSH + web only (Postgres/Redis are NOT exposed to the internet)
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# Optional but recommended on 1-2 GB servers: 2 GB swap for the frontend build
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### B4. Get the code and configure it

```bash
git clone https://github.com/adithya1258/email-scheduler.git
cd email-scheduler
cp .env.prod.example .env.prod

# Generate secrets to paste into .env.prod
openssl rand -hex 24   # -> POSTGRES_PASSWORD
openssl rand -hex 32   # -> JWT_SECRET

nano .env.prod
```

Fill in `.env.prod`:

```env
DOMAIN=scheduler.yourdomain.com
POSTGRES_PASSWORD=<first openssl value>
JWT_SECRET=<second openssl value>
GOOGLE_CLIENT_ID=<your client id from Step 1>
MAIL_MODE=ethereal
```

Everything else can stay at its default. Keep `POSTGRES_PASSWORD` to letters and digits, because
it goes inside a connection URL. The `openssl rand -hex` output is already safe.

Also add `https://scheduler.yourdomain.com` to the **Authorized JavaScript origins** in Google
Cloud (Step 1).

### B5. Start everything

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

The first build takes 3–6 minutes. Then check it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
# postgres, redis should be "healthy"; backend, frontend, caddy "Up"

docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f backend
# look for: [worker] started ... and [api] listening ...   (Ctrl+C to stop following)

curl https://scheduler.yourdomain.com/health
# {"ok":true}
```

Open `https://scheduler.yourdomain.com`. Your site is live.

### B6. Day-to-day operations

To save typing, create an alias:

```bash
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.prod'
```

| Task                                   | Command                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| Deploy a new version after `git push`  | `git pull && dc up -d --build`                                           |
| View logs                              | `dc logs -f backend` (or `frontend`, `caddy`)                            |
| Restart the backend                    | `dc restart backend` (in-flight sends finish first; scheduled jobs are kept) |
| Stop everything (data is kept)         | `dc down`                                                                |
| Back up the database                   | `dc exec -T postgres pg_dump -U postgres email_scheduler > backup-$(date +%F).sql` |
| Restore a backup                       | `cat backup.sql \| dc exec -T postgres psql -U postgres email_scheduler`  |
| Open a SQL shell                       | `dc exec postgres psql -U postgres email_scheduler`                      |

> ⚠️ `dc down -v` **deletes all data** (the database, Redis, and certificates). Only use `-v` if you really mean it.

Containers have `restart: unless-stopped`, so they come back up automatically after a server reboot.

---

## Option C: Your own computer + a public link (Cloudflare quick tunnel)

This runs the whole stack in **Docker on your own computer** (Windows, macOS or Linux).
[Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
then give it a public `https://<random-words>.trycloudflare.com` link. You don't need a Cloudflare
account, a domain, port forwarding or any credentials.

**Good to know before you start:**
- The link works only while your computer is on and Docker is running.
- The link **changes every time the tunnel restarts**. Quick tunnels are meant for demos and
  testing. For a permanent URL use Option A or B.
- Your data (users, emails) is kept in Docker volumes on your computer between restarts.

### C1. Requirements

- **Docker Desktop** (Windows/macOS) or Docker Engine (Linux), running. Check in a terminal:
  ```bash
  docker --version
  docker compose version
  ```
- **Git** (<https://git-scm.com/downloads>), or download the repo as a ZIP from GitHub
  (**Code → Download ZIP**) and unzip it.
- Around 4 GB of free RAM for Docker while building. On Docker Desktop you can change this under
  **Settings → Resources**.

### C2. Get the code and create the settings file

**macOS / Linux (Terminal):**

```bash
git clone https://github.com/adithya1258/email-scheduler.git
cd email-scheduler
cp .env.tunnel.example .env.prod
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/adithya1258/email-scheduler.git
cd email-scheduler
copy .env.tunnel.example .env.prod
```

Open `.env.prod` in any text editor (e.g. `notepad .env.prod`) and fill in the two secrets with
long random **letters and digits**. Any 30+ characters will do:

```env
DOMAIN=:80
POSTGRES_PASSWORD=pick32randomlettersanddigits1234
JWT_SECRET=another40randomlettersanddigitsabcdef1234
GOOGLE_CLIENT_ID=
MAIL_MODE=ethereal
```

Leave `DOMAIN=:80` exactly as it is. You can leave `GOOGLE_CLIENT_ID` empty for now:
email/password sign-up works without it. See C5 to turn on Google login.

### C3. Start everything, including the tunnel

Run this from the `email-scheduler` folder (the same command works on every OS):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tunnel up -d --build
```

The first run downloads images and builds the app, which takes 3–10 minutes. Then check that
everything is up:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tunnel ps
```

You should see `postgres` and `redis` **healthy**, and `backend`, `frontend`, `caddy` and
`cloudflared` **Up**.

At this point <http://localhost> already works on your own computer.

### C4. Get your public link

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tunnel logs cloudflared
```

Look for a box like this:

```
Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):
https://calm-river-example-words.trycloudflare.com
```

**That `https://….trycloudflare.com` address is your public link.** Open it and share it. It can
take up to a minute to start working. Sign up with email and password, then try the checklist in
[Checking the deployment works](#checking-the-deployment-works).

### C5. (Optional) Turn on Google login

1. Create the OAuth client as in [Step 1](#step-1-create-google-oauth-credentials). Add your
   `https://….trycloudflare.com` link (and `http://localhost`) under **Authorized JavaScript origins**.
2. Put the client ID in `.env.prod` as `GOOGLE_CLIENT_ID=...`.
3. Rebuild, because the frontend needs the ID baked in:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tunnel up -d --build
   ```

If the tunnel restarts and you get a new link, add the new link to the Google origins as well.

### C6. Stopping, starting and updating

| Task | Command |
| --- | --- |
| Stop everything (data is kept) | `docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tunnel down` |
| Start again later | `docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tunnel up -d` then get the **new** link with the `logs cloudflared` command |
| Update to the latest code | `git pull` then the `up -d --build` command from C3 |
| Backend logs | `docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f backend` |

If `caddy` won't start because port 80 or 443 is already in use (for example by Skype, IIS or
another web server), stop that program, or edit the `caddy` → `ports` section of
`docker-compose.prod.yml`: change `'80:80'` to `'8080:80'` and `'443:443'` to `'8443:443'`.
The tunnel keeps working either way, and locally you'd use <http://localhost:8080>.

---

## Option D: Vercel only (frontend demo mode)

This deploys **only the Next.js frontend** to Vercel. It needs no database, Redis, server or
credentials. In this mode the frontend switches to a **backend simulated in the browser**
(`frontend/src/lib/demo/server.ts`). It serves the same API routes and follows the same rules as
the real worker:

- each email waits until its time (`start + i × delay`),
- there's a 2-second minimum gap between sends,
- each sender has an hourly limit, and extra emails move into the next hour in their original order,
- **Stop server / Start server** buttons in the **Server console** panel reproduce the restart
  scenario. While stopped, the dashboard can't reach the API. On start, pending emails are
  recovered and overdue ones go out immediately,
- a page reload also acts like a restart, and the data persists,
- only one browser tab runs the worker, so nothing is sent twice.

The Server console shows the same log lines as the real backend
(`sent -> x (7/20 this hour)`, `hourly limit (20) reached: … rescheduled to 18:00:00`, `[recovery] …`).

**Differences from the real backend:** emails aren't actually delivered (no SMTP/Ethereal).
Data lives in the visitor's browser (localStorage), so each visitor has their own separate demo.
Sending only happens while a tab with the app is open. Google login needs the real backend, so
use email sign-up.

### D1. Deploy (about 2 minutes)

1. Go to <https://vercel.com/new> and sign in with GitHub.
2. Find **`adithya1258/email-scheduler`** and click **Import**. If it isn't listed, click
   **Adjust GitHub App Permissions** and give Vercel access to the repo.
3. **Root Directory**: click **Edit** and choose **`frontend`**. Leave everything else at the
   defaults (Framework: Next.js).
4. Don't add any environment variables. On Vercel, if `NEXT_PUBLIC_API_URL` isn't set, the build
   switches to demo mode automatically.
5. Click **Deploy**. After about a minute you get your link, e.g.
   `https://email-scheduler-xyz.vercel.app`.

Every later `git push` to `main` redeploys automatically.

### D2. Try it

1. Open the link and **Sign up** with any email and password. The account is stored only in
   your browser.
2. **Compose → Upload List →** `samples/leads.csv` from the repo (download it from GitHub).
   Set Delay `5` and Hourly Limit `50`, then **Send Later → Now → Done**. Watch **Scheduled**
   move to **Sent** and the Server console log each send.
3. **Restart:** schedule 3 emails 20 s apart and click **Stop server** after the first one is
   sent. The dashboard shows "Failed to fetch". Wait 30 s and click **Start server**: the missed
   one sends immediately and the last one sends on time.
4. **Rate limit:** upload `samples/load-test.csv` with Delay `0` and Hourly Limit `20`. Sends go
   out 2 s apart until the limit, then the rest move to the next hour.
5. The ↺ button in the Server console clears all demo data in your browser.

> To switch the Vercel deployment to the **real** backend later, deploy the backend (Option A),
> then set `NEXT_PUBLIC_API_URL` in Vercel and redeploy. Demo mode turns off automatically.
> You can also force either mode with `NEXT_PUBLIC_DEMO_MODE=true` / `false`.

---

## Ethereal: viewing the emails you send

[Ethereal](https://ethereal.email) is a fake SMTP service. Emails are accepted but never
delivered to real inboxes, which makes it safe for demos.

- **Per email:** open any sent email in the dashboard and click **View in Ethereal inbox**.
  That preview link works without logging in.
- **Everything in one inbox:** go to <https://ethereal.email/create> and click **Create Ethereal
  Account**. Copy the username and password into the backend variables `ETHEREAL_USER` and
  `ETHEREAL_PASS` (Railway variables, or `.env.prod` then `dc up -d`). Log in at
  <https://ethereal.email/login> with the same details to see every message the scheduler sent.

If you don't set them, the backend creates an Ethereal account on first start and saves it in the
database, so it stays the same across restarts.

---

## Checking the deployment works

Go through this once after deploying:

1. `https://<backend or domain>/health` shows `{"ok":true}`.
2. Open the frontend. The **Login** page appears.
3. Click **Login with Google**. A Google popup appears, and after choosing your account you land
   on **Scheduled**. Your name and avatar show in the sidebar.
4. Click **Compose**:
   - The **From** dropdown shows an `…@ethereal.email` address.
   - Click **Upload List** and pick a `.csv` containing a few email addresses. You should see
     "N emails detected".
   - Enter a subject, a body, **Delay between 2 emails** = `5`, and **Hourly Limit** = `2`.
   - Click **Send Later → Now → Done**.
5. Open **Scheduled**. The emails appear with orange time pills.
6. Within a few seconds the first 2 move to **Sent**. The rest show a time at the start of the
   next hour. That's the hourly limit working.
7. Open a sent email and click **View in Ethereal inbox**. The message is there.
8. Optional restart test: schedule an email 2 minutes ahead, then restart the backend
   (Railway: **⋯ → Restart**; VPS: `dc restart backend`). It's still sent on time.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Google popup shows **Error 400: origin_mismatch** / "invalid origin" | The frontend URL isn't in the OAuth client's origins | Add the exact URL (scheme + host, no path, no trailing slash) under **Authorized JavaScript origins**; wait a few minutes |
| Google popup: "Access blocked: app has not completed verification" / "not a test user" | App is in *Testing* mode | Add the account under **Test users**, or **Publish app** |
| "Login with Google" button is greyed out | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` was missing when the frontend was built | Set it, then **redeploy** the frontend (VPS: `dc up -d --build`) |
| After Google login: "GOOGLE_CLIENT_ID is not configured on the server" | Backend variable missing | Set `GOOGLE_CLIENT_ID` on the backend |
| After Google login: "Google sign-in could not be verified" | Frontend and backend use **different** client IDs | Use the same ID in both |
| Browser console: **CORS** error / "blocked by CORS policy" | `CORS_ORIGIN` doesn't exactly match the frontend URL | Set `CORS_ORIGIN` to the exact URL, e.g. `https://app.vercel.app` (no trailing slash) |
| Frontend shows "Failed to fetch" everywhere | Wrong `NEXT_PUBLIC_API_URL`, or backend down | Check `<api>/health`; fix the variable and redeploy the frontend |
| Emails stuck in **Scheduled**, then **Failed** with `ETIMEDOUT` / `Greeting never received` | Host blocks outgoing SMTP (port 587) | See the [SMTP note](#a-note-on-smtp-ports) |
| Backend crashes with `ECONNREFUSED ...:5432` or `...:6379` | Database/Redis URL wrong or service not ready | Railway: check the `${{Postgres...}}` / `${{Redis...}}` references match the service names. VPS: `dc ps`, and check they're healthy |
| Railway: `ENOTFOUND redis.railway.internal` | Private network not ready yet, or Redis service renamed | Redeploy; check the reference name. The backend already supports Railway's IPv6 private network |
| VPS: browser says the certificate is invalid, or Caddy logs `challenge failed` | DNS not pointing at the server yet, or ports 80/443 closed | Check the A record (`ping domain`), run `ufw status`, then `dc restart caddy` |
| VPS: frontend build killed / `exit code 137` | Not enough RAM during `next build` | Add swap (B3) or use a 2 GB+ server |
| Emails sent later than scheduled | The hourly limit or the minimum gap (`MIN_DELAY_BETWEEN_EMAILS_MS`) is throttling them | Expected behaviour; raise the limits if needed |

---

## Environment variable reference

### Backend

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | PostgreSQL 13+ connection string |
| `REDIS_URL` | yes | — | Redis 6.2+ connection string |
| `JWT_SECRET` | yes | — | Secret for signing login sessions. Long and random |
| `GOOGLE_CLIENT_ID` | for Google login | — | OAuth Web client ID (same as the frontend's) |
| `CORS_ORIGIN` | yes | `http://localhost:3000` | Frontend URL(s), comma-separated |
| `PORT` | no | `4000` | HTTP port (set automatically by Railway, Render and similar hosts) |
| `RUN_WORKER` | no | `true` | Run the BullMQ worker inside the API process |
| `WORKER_CONCURRENCY` | no | `5` | Jobs processed in parallel per worker process |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | no | `2000` | Minimum gap between any two sends, across all workers |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | no | `200` | Upper limit on the per-campaign hourly limit |
| `MAIL_MODE` | no | `ethereal` | `ethereal` = real SMTP to Ethereal; `log` = log only |
| `ETHEREAL_USER` / `ETHEREAL_PASS` | no | auto-created | Fixed Ethereal account |

### Frontend (set at build time)

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | yes | Backend base URL, no trailing slash |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | for Google login | OAuth Web client ID |
