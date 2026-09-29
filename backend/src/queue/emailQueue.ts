import { Queue } from 'bullmq';
import { QUEUE_NAME } from '../config';
import { createRedis } from './connection';

export interface SendEmailJob {
  emailId: string;
}

export const emailQueue = new Queue<SendEmailJob>(QUEUE_NAME, {
  connection: createRedis(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

/**
 * Job spec for one email row, delayed until its scheduled time.
 * jobId === emailId, so adding the same email twice is a no-op in BullMQ:
 * this is what makes scheduling + restart recovery idempotent.
 */
export function toJob(emailId: string, scheduledAt: Date) {
  return {
    name: 'send',
    data: { emailId },
    opts: { jobId: emailId, delay: Math.max(0, scheduledAt.getTime() - Date.now()) },
  };
}
