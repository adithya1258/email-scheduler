import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { listSenders } from '../services/mailer';
import { scheduleCampaign, scheduleSchema } from '../services/scheduler';

const router = Router();
router.use(requireAuth);

router.get('/senders', async (_req, res) => {
  res.json({ senders: await listSenders() });
});

router.post('/emails/schedule', async (req, res) => {
  const input = scheduleSchema.parse(req.body);
  const result = await scheduleCampaign(req.user!.id, input);
  res.status(201).json(result);
});

const TAB_STATUSES: Record<string, string[]> = {
  scheduled: ['scheduled', 'sending'],
  sent: ['sent', 'failed'],
};

const listQuery = z.object({
  tab: z.enum(['scheduled', 'sent']).default('scheduled'),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const LIST_COLUMNS = `e.id, e.to_email, e.subject, e.body, e.status, e.scheduled_at, e.sent_at,
  e.preview_url, e.error, e.starred, s.email AS from_email, s.name AS from_name`;

router.get('/emails', async (req, res) => {
  const q = listQuery.parse(req.query);
  const params: unknown[] = [req.user!.id, TAB_STATUSES[q.tab]];
  let where = 'e.user_id = $1 AND e.status = ANY($2)';
  if (q.search) {
    params.push(`%${q.search}%`);
    where += ` AND (e.to_email ILIKE $${params.length} OR e.subject ILIKE $${params.length})`;
  }
  const order = q.tab === 'scheduled' ? 'e.scheduled_at ASC' : 'COALESCE(e.sent_at, e.updated_at) DESC';

  const [items, total] = await Promise.all([
    pool.query(
      `SELECT ${LIST_COLUMNS} FROM emails e JOIN senders s ON s.id = e.sender_id
        WHERE ${where} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${q.offset}`,
      params,
    ),
    pool.query(`SELECT count(*)::int AS n FROM emails e WHERE ${where}`, params),
  ]);
  res.json({ items: items.rows, total: total.rows[0].n });
});

router.get('/emails/stats', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE status IN ('scheduled', 'sending'))::int AS scheduled,
            count(*) FILTER (WHERE status IN ('sent', 'failed'))::int AS sent,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM emails WHERE user_id = $1`,
    [req.user!.id],
  );
  res.json(rows[0]);
});

router.get('/emails/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS}, e.attempts, e.message_id, e.created_at, e.campaign_id
       FROM emails e JOIN senders s ON s.id = e.sender_id
      WHERE e.id = $1 AND e.user_id = $2`,
    [id, req.user!.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Email not found' });
  res.json(rows[0]);
});

router.patch('/emails/:id/star', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { starred } = z.object({ starred: z.boolean() }).parse(req.body);
  const { rowCount } = await pool.query(
    'UPDATE emails SET starred = $3 WHERE id = $1 AND user_id = $2',
    [id, req.user!.id, starred],
  );
  if (!rowCount) return res.status(404).json({ error: 'Email not found' });
  res.json({ id, starred });
});

export default router;
