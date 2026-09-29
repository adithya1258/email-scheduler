import { Redis } from 'ioredis';
import { config } from '../config';

// BullMQ requires maxRetriesPerRequest: null on the connections it uses for blocking commands.
// family: 0 resolves both IPv4 and IPv6, needed for private networks such as Railway's.
export function createRedis(): Redis {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null, family: 0 });
}

// Shared connection for plain commands (rate-limit counters, etc.)
export const redis = createRedis();
