import { redis } from '../queue/connection';

const HOUR_MS = 60 * 60 * 1000;

// Atomic "take a slot if one is free" for a fixed hourly window.
// Runs inside Redis, so it is safe with any number of workers / processes.
const TAKE_SLOT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return current
`;

export function hourWindow(now = Date.now()): number {
  return Math.floor(now / HOUR_MS);
}

export type SlotResult = { allowed: true } | { allowed: false; retryAt: Date };

/**
 * Try to reserve one send for `senderId` in the current hour window.
 *
 * When the window is full, the caller gets a `retryAt` inside the next window.
 * Each overflowing job takes a ticket in the next window so rescheduled jobs
 * are spread out by `spacingMs` (keeping their original order) instead of
 * all waking up at exactly hh:00:00.
 */
export async function takeHourlySlot(
  senderId: string,
  limit: number,
  spacingMs: number,
  now = Date.now(),
): Promise<SlotResult> {
  const window = hourWindow(now);
  const key = `ratelimit:sender:${senderId}:${window}`;
  const got = (await redis.eval(TAKE_SLOT, 1, key, String(limit), String(2 * HOUR_MS))) as number;
  if (got > 0) return { allowed: true };

  const nextWindowStart = (window + 1) * HOUR_MS;
  const ticketKey = `ratelimit:overflow:${senderId}:${window + 1}`;
  const ticket = await redis.incr(ticketKey);
  if (ticket === 1) await redis.pexpire(ticketKey, 2 * HOUR_MS);
  return { allowed: false, retryAt: new Date(nextWindowStart + (ticket - 1) * spacingMs) };
}

export async function usedInCurrentWindow(senderId: string): Promise<number> {
  const v = await redis.get(`ratelimit:sender:${senderId}:${hourWindow()}`);
  return v ? Number(v) : 0;
}
