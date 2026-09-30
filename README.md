# Email Scheduler

Email Scheduler helps you create email campaigns and send messages to many recipients over time. Sign in, add recipients, write your message, and choose when and how quickly emails should be sent.

## Features

### Backend

- Creates campaigns and saves recipients in PostgreSQL
- Schedules email jobs with BullMQ and Redis
- Tracks each email as scheduled, sending, sent, or failed
- Recovers pending emails after a restart
- Limits send rates across workers and enforces hourly sending caps
- Supports multiple workers processing jobs concurrently
- Sends email through SMTP, including Ethereal for testing

### Frontend

- Sign in with Google or with an email and password
- View scheduled and sent emails in a dashboard
- Search and filter email lists, with status counts
- Compose campaigns with a sender, recipients, subject, message, send delay, and hourly limit
- Add recipients by typing, pasting, or uploading a CSV or text file
- Format message content with a rich text editor
- View email details, delivery attempts, errors, and Ethereal preview links
- Use the dashboard on mobile screens

## Project structure

- `backend/` — Express API and BullMQ worker
- `frontend/` — Next.js dashboard
- `docker-compose.yml` — PostgreSQL and Redis for development
- `docker-compose.prod.yml` — Production services
- `Caddyfile` — Reverse proxy and HTTPS configuration

## Requirements

- Node.js 20 or later
- Docker, or PostgreSQL 14+ and Redis 6.2+

## Run the backend

Start PostgreSQL and Redis from the project root:

```bash
docker compose up -d
```

In a separate terminal, install and start the backend:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Set the required values in `backend/.env`, including `GOOGLE_CLIENT_ID` and `JWT_SECRET`. The API runs on port 4000, and the worker starts with it. Database tables are created automatically.

To run the API and worker separately:

```bash
RUN_WORKER=false npm run dev
npm run dev:worker
```

You can run more than one worker to process jobs concurrently.

For production:

```bash
npm run build
npm start
```

## Run the frontend

In another terminal:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in `frontend/.env.local`. Open [http://localhost:3000](http://localhost:3000).

## Set up Google sign-in

1. In Google Cloud Console, create an OAuth client for a web app.
2. Add `http://localhost:3000` as an authorized JavaScript origin.
3. Set the client ID in both `backend/.env` (`GOOGLE_CLIENT_ID`) and `frontend/.env.local` (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`).

Users can also sign up and sign in with an email address and password.

## Set up Ethereal Email

Ethereal is a test email service. It captures messages and provides preview links instead of delivering them to real inboxes.

The app creates and reuses an Ethereal account by default. To use your own account:

1. Create an account at [ethereal.email](https://ethereal.email/create).
2. Add the account credentials to `backend/.env`:

```env
ETHEREAL_USER=your_ethereal_username
ETHEREAL_PASS=your_ethereal_password
```

Each test email includes a preview link in the dashboard.

To run without an email service, set this in `backend/.env`:

```env
MAIL_MODE=log
```

In log mode, email details are printed to the backend console.

Other settings are documented in `backend/.env.example` and `frontend/.env.example`.

## Architecture

### Scheduling

When a campaign is created, the backend saves the campaign and its recipient emails in a PostgreSQL transaction. It then creates a BullMQ job for each email and schedules it in Redis.

Each email gets a send time based on the campaign start time and the delay between messages. Redis makes jobs available to workers at their scheduled times.

### Persistence and restart recovery

PostgreSQL is the source of truth for campaign and email status. BullMQ stores queued jobs in Redis, so jobs remain available across server restarts.

When a worker starts, it checks the database for emails that are still pending and re-queues them if needed. During shutdown, workers finish in-progress work before exiting.

### Rate limits and concurrency

- **Campaign delay:** Sets the time between emails in one campaign.
- **Minimum send gap:** Spaces out sends across workers.
- **Hourly limit:** Caps the number of emails sent by a sender in an hour. A shared Redis counter keeps the count consistent across workers.
- **Worker concurrency:** Controls how many jobs one worker can process at the same time. Multiple worker processes can run together.
- **Server limit:** Sets the maximum hourly cap users can choose.

If the hourly limit is reached, queued emails are moved to the next available hour rather than dropped. The dashboard updates with their new send times.

### Preventing duplicate sends

Each email has a unique job ID. Before sending, a worker also updates the email's database status from `scheduled` to `sending`. Only one worker can claim it.

If a worker crashes while an email is being sent, the job is retried after five minutes. A duplicate is possible if the email was delivered before the crash but the worker did not record the result.
