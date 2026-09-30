# Email Scheduler

Email Scheduler lets you create campaigns and send emails over time. Sign in, add recipients, write your message, and choose when and how quickly to send it.

## Features

- Sign in with Google or an email and password
- Schedule emails and track their status
- Add recipients by typing, pasting, or uploading a CSV or text file
- Set a delay between emails and an hourly sending limit
- Preview test emails with Ethereal
- View scheduled, sent, and failed emails

## Project structure

- `backend/` — API and email worker
- `frontend/` — web dashboard
- `docker-compose.yml` — development database services
- `docker-compose.prod.yml` — production setup
- `Caddyfile` — HTTPS and reverse proxy settings
- `DEPLOYMENT.md` — deployment instructions

For deployment, see [DEPLOYMENT.md](DEPLOYMENT.md). You can also deploy the frontend to Vercel to try its browser-based demo mode.

## Run locally

### Requirements

- Node.js 20 or later
- Docker, or PostgreSQL 14+ and Redis 6.2+

### Start PostgreSQL and Redis

```bash
docker compose up -d
```

### Start the backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Add `GOOGLE_CLIENT_ID` and `JWT_SECRET` to `backend/.env`. The backend starts on port 4000 and includes a worker.

To run the API and worker separately:

```bash
RUN_WORKER=false npm run dev
npm run dev:worker
```

For production, build and start the backend:

```bash
npm run build
npm start
```

### Start the frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Add `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to `frontend/.env.local`. Open [http://localhost:3000](http://localhost:3000).

## Set up Google sign-in

1. In Google Cloud Console, create an OAuth client for a web app.
2. Add `http://localhost:3000` to the authorized JavaScript origins.
3. Put the client ID in both `backend/.env` and `frontend/.env.local`.

You can also create an account with an email address and password.

## Email delivery

By default, the app creates and reuses an Ethereal account. Ethereal is for testing: it provides a preview link for each email instead of delivering it to a real inbox.

To use your own Ethereal account, set `ETHEREAL_USER` and `ETHEREAL_PASS` in `backend/.env`.

To run without sending email, set `MAIL_MODE=log`. Email details will appear in the console.

## How scheduling works

The app saves each campaign and its recipients in the database, then places email jobs in a Redis queue. The queue sends them at their scheduled times.

The database tracks each email as scheduled, sending, sent, or failed. If the server restarts, the worker checks for pending emails and adds them back to the queue. Multiple workers can run at once.

The app uses database locks and unique job IDs to prevent duplicate sends. If a worker stops while an email is being sent, the app retries it after five minutes; in that situation, a duplicate may occur.

Sending speed is controlled by the campaign delay, hourly limit, and server settings. When an hourly limit is reached, the app moves emails to the next available hour.

## API

All endpoints except authentication require this header:

```text
Authorization: Bearer <your_jwt>
```

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/google` | Sign in with Google |
| `POST` | `/api/auth/register` | Create an account |
| `POST` | `/api/auth/login` | Sign in with email and password |
| `GET` | `/api/auth/me` | Get your profile |
| `GET` | `/api/senders` | List sender accounts |
| `POST` | `/api/emails/schedule` | Create a campaign |
| `GET` | `/api/emails?tab=scheduled&search=...` | Find emails |
| `GET` | `/api/emails/stats` | Get email counts |
| `GET` | `/api/emails/:id` | Get email details and preview link |
| `PATCH` | `/api/emails/:id/star` | Star or unstar an email |
| `GET` | `/health` | Check whether the service is running |

## Configuration

See `backend/.env.example` and `frontend/.env.example` for the available settings and descriptions.
