import 'dotenv/config';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be an integer, got "${raw}"`);
  return n;
}

export const config = {
  port: int('PORT', 4000),
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/email_scheduler',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  runWorker: (process.env.RUN_WORKER ?? 'true') !== 'false',
  workerConcurrency: int('WORKER_CONCURRENCY', 5),
  minDelayBetweenEmailsMs: int('MIN_DELAY_BETWEEN_EMAILS_MS', 2000),
  maxEmailsPerHourPerSender: int('MAX_EMAILS_PER_HOUR_PER_SENDER', 200),
  mailMode: (process.env.MAIL_MODE ?? 'ethereal') as 'ethereal' | 'log',
  etherealUser: process.env.ETHEREAL_USER ?? '',
  etherealPass: process.env.ETHEREAL_PASS ?? '',
};

export const QUEUE_NAME = 'email-send';
