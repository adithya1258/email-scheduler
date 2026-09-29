import { DelayedError, Job, Worker } from 'bullmq';
import { config, QUEUE_NAME } from '../config';
import { pool } from '../db';
import { createRedis } from '../queue/connection';
import { SendEmailJob } from '../queue/emailQueue';
import { getSender, sendMail } from '../services/mailer';
import { takeHourlySlot } from '../services/rateLimiter';

// A row stuck in 'sending' longer than this is assumed to belong to a crashed worker.
const STALE_SENDING_MS = 5 * 60 * 1000;

interface ClaimedEmail {
  id: string;
  sender_id: string;
  to_email: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  hourly_limit: number;
}

async function postpone(job: Job, token: string | undefined, emailId: string, until: Date): Promise<never> {
  await pool.query(
    `UPDATE emails SET status = 'scheduled', scheduled_at = $2, updated_at = now() WHERE id = $1`,
    [emailId, until],
  );
  await job.moveToDelayed(until.getTime(), token);
  // Tells BullMQ the job was moved back to "delayed" on purpose (not a failure, no attempt used).
  throw new DelayedError();
}

async function processEmail(job: Job<SendEmailJob>, token?: string): Promise<string> {
  const { emailId } = job.data;

  // 1. Claim the row atomically. Only one worker can move it out of 'scheduled',
  //    which is what guarantees an email is never sent twice even with many workers.
  const claim = await pool.query<ClaimedEmail>(
    `UPDATE emails e
        SET status = 'sending', updated_at = now()
       FROM campaigns c
      WHERE e.id = $1 AND c.id = e.campaign_id
        AND (e.status = 'scheduled'
             OR (e.status = 'sending' AND e.updated_at < now() - make_interval(secs => $2)))
      RETURNING e.id, e.sender_id, e.to_email, e.subject, e.body, e.scheduled_at, c.hourly_limit`,
    [emailId, STALE_SENDING_MS / 1000],
  );

  if (claim.rowCount === 0) {
    const { rows } = await pool.query<{ status: string }>('SELECT status FROM emails WHERE id = $1', [emailId]);
    const status = rows[0]?.status;
    if (status === 'sending') {
      // Someone else holds it right now; check back once their claim would be stale.
      await job.moveToDelayed(Date.now() + STALE_SENDING_MS, token);
      throw new DelayedError();
    }
    return `skipped (${status ?? 'deleted'})`; // already sent / failed / removed
  }
  const email = claim.rows[0];

  // 2. Too early (e.g. re-enqueued by recovery with an old delay)? Go back to sleep.
  if (email.scheduled_at.getTime() > Date.now() + 1000) {
    return postpone(job, token, email.id, email.scheduled_at);
  }

  // 3. Hourly limit per sender, shared across all workers through Redis.
  const slot = await takeHourlySlot(email.sender_id, email.hourly_limit, config.minDelayBetweenEmailsMs);
  if (!slot.allowed) {
    console.log(`[worker] hourly limit hit for sender ${email.sender_id}; ${email.id} -> ${slot.retryAt.toISOString()}`);
    return postpone(job, token, email.id, slot.retryAt);
  }

  // 4. Send.
  const sender = await getSender(email.sender_id);
  if (!sender) throw new Error(`Sender ${email.sender_id} not found`);

  try {
    const result = await sendMail(sender, { to: email.to_email, subject: email.subject, html: email.body });
    await pool.query(
      `UPDATE emails SET status = 'sent', sent_at = now(), message_id = $2, preview_url = $3, attempts = attempts + 1,
              error = NULL, updated_at = now()
        WHERE id = $1`,
      [email.id, result.messageId, result.previewUrl],
    );
    return result.messageId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await pool.query(
      `UPDATE emails SET status = $2, error = $3, attempts = attempts + 1, updated_at = now() WHERE id = $1`,
      [email.id, finalAttempt ? 'failed' : 'scheduled', message],
    );
    throw err; // let BullMQ apply the retry/backoff policy
  }
}

export function startEmailWorker(): Worker<SendEmailJob> {
  const worker = new Worker<SendEmailJob>(QUEUE_NAME, processEmail, {
    connection: createRedis(),
    concurrency: config.workerConcurrency,
    // Global throttle stored in Redis: at most 1 job every MIN_DELAY ms across ALL workers.
    limiter: { max: 1, duration: config.minDelayBetweenEmailsMs },
  });

  worker.on('completed', (job, result) => console.log(`[worker] ${job.id} done: ${result}`));
  worker.on('failed', (job, err) => console.warn(`[worker] ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
  worker.on('error', (err) => console.error('[worker] error', err));

  console.log(
    `[worker] started: concurrency=${config.workerConcurrency}, min gap=${config.minDelayBetweenEmailsMs}ms, ` +
      `max/hour/sender=${config.maxEmailsPerHourPerSender}, mail mode=${config.mailMode}`,
  );
  return worker;
}
