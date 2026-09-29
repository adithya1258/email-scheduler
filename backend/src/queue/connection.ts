import { Redis } from 'ioredis';
import { config } from '../config';

// BullMQ requires maxRetriesPerRequest: null on the connections it uses for blocking commands.
export function createRedis(): Redis {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null });
}

// Shared connection for plain commands (rate-limit counters, etc.)
export const redis = createRedis();
