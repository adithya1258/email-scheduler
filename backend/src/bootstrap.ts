import { Worker } from 'bullmq';
import { pool } from './db';
import { log } from './logger';
import { migrate } from './db/migrate';
import { redis } from './queue/connection';
import { emailQueue } from './queue/emailQueue';
import { ensureDefaultSender } from './services/mailer';
import { recoverPendingJobs } from './services/scheduler';
import { startEmailWorker } from './workers/emailWorker';

export async function prepareInfrastructure() {
  await migrate();
  await ensureDefaultSender();
}

/** Start a worker and re-enqueue anything the DB says is still pending */
export async function startWorkerWithRecovery(): Promise<Worker> {
  const worker = startEmailWorker();
  const recovered = await recoverPendingJobs();
  log(`[recovery] ensured ${recovered} pending email job(s) are queued`);
  return worker;
}

export function registerShutdown(closers: Array<() => Promise<unknown>>) {
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log(`[shutdown] ${signal} received, closing...`);
    // Workers first: lets in-flight sends finish so nothing is left half-done.
    for (const close of closers) await close().catch((e) => console.error(e));
    await emailQueue.close();
    redis.disconnect();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
