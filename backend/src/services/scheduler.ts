import { z } from 'zod';
import { withTransaction, pool } from '../db';
import { emailQueue, toJob } from '../queue/emailQueue';
import { config } from '../config';
import { getSender } from './mailer';

export const scheduleSchema = z.object({
  senderId: z.string().uuid(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1).max(200_000),
  recipients: z.array(z.string()).min(1).max(10_000),
  startAt: z.coerce.date(),
  delayBetweenEmailsMs: z.number().int().min(0).max(24 * 3600 * 1000),
  hourlyLimit: z.number().int().min(1).max(100_000),
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function normaliseRecipients(raw: string[]): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const r of raw) {
    const e = r.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) {
      invalid.push(r);
      continue;
    }
    if (!seen.has(e)) {
      seen.add(e);
      valid.push(e);
    }
  }
  return { valid, invalid };
}

export class ValidationError extends Error {}

/**
 * Persist a campaign and one row per recipient, then enqueue one delayed BullMQ job
 * per email. Email i is scheduled at startAt + i * delay.
 *
 * DB is the source of truth: rows are committed before jobs are enqueued, and
 * `recoverPendingJobs` re-enqueues anything that is still pending on boot, so a
 * crash between the two steps cannot lose an email.
 */
export async function scheduleCampaign(userId: string, input: ScheduleInput) {
  const sender = await getSender(input.senderId);
  if (!sender) throw new ValidationError('Unknown sender');

  const { valid, invalid } = normaliseRecipients(input.recipients);
  if (valid.length === 0) throw new ValidationError('No valid recipient email addresses');

  // Never schedule in the past; small grace for clock skew between browser and server.
  const start = new Date(Math.max(input.startAt.getTime(), Date.now()));
  const hourlyLimit = Math.min(input.hourlyLimit, config.maxEmailsPerHourPerSender);

  const { campaign, emails } = await withTransaction(async (client) => {
    const c = await client.query(
      `INSERT INTO campaigns (user_id, sender_id, subject, body, start_at, delay_ms, hourly_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, sender.id, input.subject, input.body, start, input.delayBetweenEmailsMs, hourlyLimit],
    );
    const campaign = c.rows[0];

    const times = valid.map((_, i) => new Date(start.getTime() + i * input.delayBetweenEmailsMs));
    const e = await client.query<{ id: string; scheduled_at: Date }>(
      `INSERT INTO emails (campaign_id, user_id, sender_id, to_email, subject, body, scheduled_at)
       SELECT $1, $2, $3, t.to_email, $4, $5, t.scheduled_at
       FROM unnest($6::text[], $7::timestamptz[]) AS t(to_email, scheduled_at)
       RETURNING id, scheduled_at`,
      [campaign.id, userId, sender.id, input.subject, input.body, valid, times],
    );
    return { campaign, emails: e.rows };
  });

  for (let i = 0; i < emails.length; i += 500) {
    await emailQueue.addBulk(emails.slice(i, i + 500).map((e) => toJob(e.id, e.scheduled_at)));
  }

  return {
    campaignId: campaign.id as string,
    scheduled: emails.length,
    skippedInvalid: invalid,
    hourlyLimit,
    firstSendAt: start,
    lastSendAt: emails[emails.length - 1].scheduled_at,
  };
}

/**
 * Restart safety net: every email still pending in the DB gets (re)enqueued.
 * jobId === emailId, so jobs that still exist in Redis are left untouched and
 * only genuinely missing ones (e.g. Redis was flushed) are recreated.
 */
export async function recoverPendingJobs(): Promise<number> {
  const { rows } = await pool.query<{ id: string; scheduled_at: Date }>(
    `SELECT id, scheduled_at FROM emails WHERE status IN ('scheduled', 'sending')`,
  );
  for (let i = 0; i < rows.length; i += 500) {
    await emailQueue.addBulk(rows.slice(i, i + 500).map((r) => toJob(r.id, r.scheduled_at)));
  }
  return rows.length;
}
