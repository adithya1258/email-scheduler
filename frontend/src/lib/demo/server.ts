/**
 * In-browser simulation of the backend, used when the frontend is deployed on its own
 * (e.g. on Vercel) with NEXT_PUBLIC_DEMO_MODE=true.
 *
 * It implements the same REST routes as the Express API and runs a worker loop with the
 * same rules as the BullMQ worker:
 *   - each email waits until its scheduled time (startAt + i × delay)
 *   - a global minimum gap between sends (MIN_GAP_MS)
 *   - a per-sender hourly limit; overflow is moved into the next hour window, in order
 *   - "server" stop/start: while stopped the API fails and nothing sends; on start every
 *     pending email is recovered and overdue ones go out immediately
 *   - only one browser tab runs the worker (Web Locks), so an email is never sent twice
 *
 * State lives in localStorage, so it survives page reloads (a reload is a server restart).
 */

const KEY = 'es-demo-db-v1';
const MIN_GAP_MS = 2000;
const MAX_PER_HOUR = 200;
const HOUR = 3600_000;
const TICK_MS = 250;

type Status = 'scheduled' | 'sending' | 'sent' | 'failed';

interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

interface Campaign {
  id: string;
  user_id: string;
  sender_id: string;
  hourly_limit: number;
}

interface Email {
  id: string;
  campaign_id: string;
  user_id: string;
  sender_id: string;
  to_email: string;
  subject: string;
  body: string;
  scheduled_at: string;
  status: Status;
  attempts: number;
  sent_at: string | null;
  message_id: string | null;
  error: string | null;
  starred: boolean;
  created_at: string;
  updated_at: string;
}

interface DB {
  users: User[];
  campaigns: Campaign[];
  emails: Email[];
  counters: Record<string, number>; // `${senderId}:${hourWindow}` -> sends in that hour
  overflow: Record<string, number>; // `${senderId}:${hourWindow}` -> tickets handed out
  lastProcessedAt: number;
  serverUp: boolean;
  logs: string[];
}

const SENDER = { id: 'sender-1', name: 'Demo Sender', email: 'demo@scheduler.local' };

const empty = (): DB => ({
  users: [],
  campaigns: [],
  emails: [],
  counters: {},
  overflow: {},
  lastProcessedAt: 0,
  serverUp: true,
  logs: [],
});

// ---------------------------------------------------------------- storage -------------

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}

function save(db: DB) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* storage full or blocked; the demo keeps working for this page view */
  }
}

/** Read-modify-write the whole state (keeps tabs in sync through localStorage). */
function tx<T>(fn: (db: DB) => T): T {
  const db = load();
  const out = fn(db);
  save(db);
  return out;
}

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

const hms = (t: number) => new Date(t).toTimeString().slice(0, 8);

function log(db: DB, line: string) {
  db.logs.push(`${hms(Date.now())} ${line}`);
  if (db.logs.length > 300) db.logs.splice(0, db.logs.length - 300);
}

// ---------------------------------------------------------------- worker --------------

function processOne(db: DB, now: number) {
  if (!db.serverUp || now - db.lastProcessedAt < MIN_GAP_MS) return;

  let due: Email | undefined;
  for (const e of db.emails) {
    if (e.status !== 'scheduled' || Date.parse(e.scheduled_at) > now) continue;
    if (!due || e.scheduled_at < due.scheduled_at) due = e;
  }
  if (!due) return;
  db.lastProcessedAt = now;

  const limit = db.campaigns.find((c) => c.id === due.campaign_id)?.hourly_limit ?? MAX_PER_HOUR;
  const window = Math.floor(now / HOUR);
  const key = `${due.sender_id}:${window}`;
  const used = db.counters[key] ?? 0;

  if (used >= limit) {
    // Hourly limit reached: move into the next window, spaced by ticket so order is kept.
    const nextKey = `${due.sender_id}:${window + 1}`;
    const ticket = (db.overflow[nextKey] ?? 0) + 1;
    db.overflow[nextKey] = ticket;
    const retryAt = (window + 1) * HOUR + (ticket - 1) * MIN_GAP_MS;
    due.scheduled_at = new Date(retryAt).toISOString();
    due.updated_at = new Date(now).toISOString();
    log(db, `[worker] hourly limit (${limit}) reached: ${due.to_email} rescheduled to ${hms(retryAt)}`);
    return;
  }

  db.counters[key] = used + 1;
  due.status = 'sent';
  due.attempts += 1;
  due.sent_at = new Date(now).toISOString();
  due.updated_at = due.sent_at;
  due.message_id = `<${uuid()}@scheduler.local>`;
  log(db, `[worker] sent -> ${due.to_email} (${used + 1}/${limit} this hour)`);

  // Forget counters for windows that have passed.
  for (const k of Object.keys(db.counters)) if (Number(k.split(':').pop()) < window - 1) delete db.counters[k];
  for (const k of Object.keys(db.overflow)) if (Number(k.split(':').pop()) < window) delete db.overflow[k];
}

function bootLines(db: DB) {
  const pending = db.emails.filter((e) => e.status === 'scheduled' || e.status === 'sending').length;
  log(db, `[worker] started: min gap=${MIN_GAP_MS}ms, max/hour/sender=${MAX_PER_HOUR}, mail mode=simulated`);
  log(db, '[api] listening (in-browser simulation)');
  log(db, `[recovery] ensured ${pending} pending email job(s) are queued`);
}

let workerStarted = false;

function runWorkerLoop() {
  tx((db) => {
    if (db.serverUp) bootLines(db);
  });
  setInterval(() => tx((db) => processOne(db, Date.now())), TICK_MS);
}

/** Start the worker in exactly one tab; other tabs wait for the lock. */
export function ensureWorker() {
  if (workerStarted || typeof window === 'undefined') return;
  workerStarted = true;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) {
    locks.request('es-demo-worker', () => {
      runWorkerLoop();
      return new Promise<void>(() => {}); // hold the lock for the tab's lifetime
    });
  } else {
    runWorkerLoop();
  }
}

// ---------------------------------------------------------------- server controls -----

export function isServerUp() {
  return load().serverUp;
}

export function getLogs() {
  return load().logs;
}

export function stopServer() {
  tx((db) => {
    if (!db.serverUp) return;
    db.serverUp = false;
    log(db, '[shutdown] SIGINT received, closing...');
  });
}

export function startServer() {
  tx((db) => {
    if (db.serverUp) return;
    db.serverUp = true;
    bootLines(db);
  });
}

export function resetDemo() {
  save(empty());
  tx((db) => bootLines(db));
}

// ---------------------------------------------------------------- API -----------------

type Res = { status: number; data: unknown };
const ok = (data: unknown, status = 200): Res => ({ status, data });
const fail = (status: number, error: string): Res => ({ status, data: { error } });

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

async function hash(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`es-demo:${s}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, avatarUrl: null });
const session = (u: User) => ({ token: `demo.${u.id}`, user: publicUser(u) });

function listItem(e: Email) {
  return {
    id: e.id,
    to_email: e.to_email,
    subject: e.subject,
    body: e.body,
    status: e.status,
    scheduled_at: e.scheduled_at,
    sent_at: e.sent_at,
    preview_url: null,
    error: e.error,
    starred: e.starred,
    from_email: SENDER.email,
    from_name: SENDER.name,
  };
}

async function route(method: string, url: URL, body: Record<string, unknown>, token: string | null): Promise<Res> {
  const path = url.pathname;

  if (method === 'GET' && path === '/health') return ok({ ok: true });

  // ---- auth
  if (method === 'POST' && (path === '/api/auth/register' || path === '/api/auth/login')) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!EMAIL_RE.test(email) || password.length < 6) return fail(400, 'Invalid request');
    const passwordHash = await hash(password);
    return tx((db) => {
      const existing = db.users.find((u) => u.email === email);
      if (path.endsWith('register')) {
        if (existing) return fail(409, 'An account with this email already exists');
        const name = String(body.name ?? '').trim() || email.split('@')[0];
        const user = { id: uuid(), email, name, passwordHash };
        db.users.push(user);
        return ok(session(user), 201);
      }
      if (!existing || existing.passwordHash !== passwordHash) return fail(401, 'Invalid email or password');
      return ok(session(existing));
    });
  }
  if (method === 'POST' && path === '/api/auth/google') {
    return fail(400, 'Google login needs the real backend. In this browser demo, sign up with email.');
  }

  const db = load();
  const user = token?.startsWith('demo.') ? db.users.find((u) => u.id === token.slice(5)) : undefined;
  if (!user) return fail(401, 'Not authenticated');

  if (method === 'GET' && path === '/api/auth/me') return ok({ user: publicUser(user) });
  if (method === 'GET' && path === '/api/senders') return ok({ senders: [SENDER] });

  // ---- schedule a campaign
  if (method === 'POST' && path === '/api/emails/schedule') {
    const subject = String(body.subject ?? '').trim();
    const html = String(body.body ?? '');
    const delay = Number(body.delayBetweenEmailsMs);
    const hourly = Number(body.hourlyLimit);
    const startAt = Date.parse(String(body.startAt ?? ''));
    const raw = Array.isArray(body.recipients) ? body.recipients.map(String) : [];
    if (!subject || !html || !Number.isInteger(delay) || delay < 0 || !Number.isInteger(hourly) || hourly < 1 || Number.isNaN(startAt)) {
      return fail(400, 'Invalid request');
    }
    if (body.senderId !== SENDER.id) return fail(400, 'Unknown sender');

    const seen = new Set<string>();
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const r of raw) {
      const e = r.trim().toLowerCase();
      if (!e) continue;
      if (!EMAIL_RE.test(e)) invalid.push(r);
      else if (!seen.has(e)) {
        seen.add(e);
        valid.push(e);
      }
    }
    if (valid.length === 0) return fail(400, 'No valid recipient email addresses');

    const start = Math.max(startAt, Date.now());
    const hourlyLimit = Math.min(hourly, MAX_PER_HOUR);
    return tx((db) => {
      const campaign = { id: uuid(), user_id: user.id, sender_id: SENDER.id, hourly_limit: hourlyLimit };
      db.campaigns.push(campaign);
      const now = new Date().toISOString();
      const created = valid.map((to, i) => ({
        id: uuid(),
        campaign_id: campaign.id,
        user_id: user.id,
        sender_id: SENDER.id,
        to_email: to,
        subject,
        body: html,
        scheduled_at: new Date(start + i * delay).toISOString(),
        status: 'scheduled' as const,
        attempts: 0,
        sent_at: null,
        message_id: null,
        error: null,
        starred: false,
        created_at: now,
        updated_at: now,
      }));
      db.emails.push(...created);
      return ok(
        {
          campaignId: campaign.id,
          scheduled: created.length,
          skippedInvalid: invalid,
          hourlyLimit,
          firstSendAt: created[0].scheduled_at,
          lastSendAt: created[created.length - 1].scheduled_at,
        },
        201,
      );
    });
  }

  const mine = db.emails.filter((e) => e.user_id === user.id);

  // ---- lists / stats
  if (method === 'GET' && path === '/api/emails') {
    const tab = url.searchParams.get('tab') === 'sent' ? 'sent' : 'scheduled';
    const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
    const statuses = tab === 'scheduled' ? ['scheduled', 'sending'] : ['sent', 'failed'];
    let rows = mine.filter((e) => statuses.includes(e.status));
    if (search) rows = rows.filter((e) => e.to_email.includes(search) || e.subject.toLowerCase().includes(search));
    rows.sort((a, b) =>
      tab === 'scheduled'
        ? a.scheduled_at.localeCompare(b.scheduled_at)
        : (b.sent_at ?? b.updated_at).localeCompare(a.sent_at ?? a.updated_at),
    );
    return ok({ items: rows.slice(offset, offset + limit).map(listItem), total: rows.length });
  }
  if (method === 'GET' && path === '/api/emails/stats') {
    return ok({
      scheduled: mine.filter((e) => e.status === 'scheduled' || e.status === 'sending').length,
      sent: mine.filter((e) => e.status === 'sent' || e.status === 'failed').length,
      failed: mine.filter((e) => e.status === 'failed').length,
    });
  }

  // ---- single email
  const m = /^\/api\/emails\/([^/]+)(\/star)?$/.exec(path);
  if (m) {
    const email = mine.find((e) => e.id === m[1]);
    if (!email) return fail(404, 'Email not found');
    if (method === 'GET' && !m[2]) {
      return ok({
        ...listItem(email),
        attempts: email.attempts,
        message_id: email.message_id,
        created_at: email.created_at,
        campaign_id: email.campaign_id,
      });
    }
    if (method === 'PATCH' && m[2]) {
      const starred = Boolean(body.starred);
      tx((db) => {
        const e = db.emails.find((x) => x.id === email.id);
        if (e) e.starred = starred;
      });
      return ok({ id: email.id, starred });
    }
  }

  return fail(404, 'Not found');
}

/** Drop-in replacement for fetch() against the backend. */
export async function demoFetch(path: string, init: RequestInit, token: string | null): Promise<Res> {
  ensureWorker();
  await new Promise((r) => setTimeout(r, 80 + Math.random() * 120)); // network-ish latency
  // A stopped server behaves like an unreachable one.
  if (!isServerUp()) throw new TypeError('Failed to fetch');
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  return route((init.method ?? 'GET').toUpperCase(), new URL(path, 'http://demo.local'), body, token);
}
