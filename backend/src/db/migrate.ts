import { pool } from './index';

// Idempotent schema; safe to run on every boot.
// gen_random_uuid() is built into PostgreSQL 13+, so no extension (and no superuser) is needed.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  avatar_url    TEXT,
  google_id     TEXT UNIQUE,
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS senders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  smtp_host  TEXT NOT NULL,
  smtp_port  INTEGER NOT NULL,
  smtp_user  TEXT NOT NULL,
  smtp_pass  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES senders(id),
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  start_at     TIMESTAMPTZ NOT NULL,
  delay_ms     INTEGER NOT NULL,
  hourly_limit INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emails (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES senders(id),
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'sending', 'sent', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  sent_at      TIMESTAMPTZ,
  message_id   TEXT,
  preview_url  TEXT,
  error        TEXT,
  starred      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, to_email)
);

CREATE INDEX IF NOT EXISTS emails_user_status_idx ON emails (user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS emails_status_idx ON emails (status);
`;

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    // API and worker processes may boot at the same time; serialise the DDL.
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(SCHEMA);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}
