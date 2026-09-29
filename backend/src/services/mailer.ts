import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { pool } from '../db';
import { log } from '../logger';

export interface Sender {
  id: string;
  name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

const transporters = new Map<string, Transporter>();

function getTransporter(sender: Sender): Transporter {
  let t = transporters.get(sender.id);
  if (!t) {
    t =
      config.mailMode === 'log'
        ? nodemailer.createTransport({ jsonTransport: true })
        : nodemailer.createTransport({
            host: sender.smtp_host,
            port: sender.smtp_port,
            secure: sender.smtp_port === 465,
            auth: { user: sender.smtp_user, pass: sender.smtp_pass },
          });
    transporters.set(sender.id, t);
  }
  return t;
}

async function upsertSender(s: Omit<Sender, 'id'>): Promise<Sender> {
  const { rows } = await pool.query<Sender>(
    `INSERT INTO senders (name, email, smtp_host, smtp_port, smtp_user, smtp_pass)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE
       SET smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port,
           smtp_user = EXCLUDED.smtp_user, smtp_pass = EXCLUDED.smtp_pass
     RETURNING *`,
    [s.name, s.email, s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_pass],
  );
  return rows[0];
}

/**
 * Make sure at least one sender mailbox exists.
 * - ETHEREAL_USER/PASS set  -> use that account.
 * - otherwise, reuse an account stored in the DB, or create a fresh Ethereal
 *   account once and persist it so it survives restarts.
 */
export async function ensureDefaultSender(): Promise<void> {
  if (config.etherealUser && config.etherealPass) {
    await upsertSender({
      name: config.etherealUser.split('@')[0],
      email: config.etherealUser,
      smtp_host: 'smtp.ethereal.email',
      smtp_port: 587,
      smtp_user: config.etherealUser,
      smtp_pass: config.etherealPass,
    });
    return;
  }

  const { rowCount } = await pool.query('SELECT 1 FROM senders LIMIT 1');
  if (rowCount) return;

  if (config.mailMode === 'log') {
    await upsertSender({
      name: 'Demo Sender',
      email: 'demo@scheduler.local',
      smtp_host: 'localhost',
      smtp_port: 587,
      smtp_user: 'demo',
      smtp_pass: 'demo',
    });
    return;
  }

  const account = await nodemailer.createTestAccount();
  await upsertSender({
    name: account.user.split('@')[0],
    email: account.user,
    smtp_host: account.smtp.host,
    smtp_port: account.smtp.port,
    smtp_user: account.user,
    smtp_pass: account.pass,
  });
  log(`[mailer] created Ethereal account ${account.user} (login at https://ethereal.email)`);
}

export async function getSender(id: string): Promise<Sender | null> {
  const { rows } = await pool.query<Sender>('SELECT * FROM senders WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function listSenders(): Promise<Pick<Sender, 'id' | 'name' | 'email'>[]> {
  const { rows } = await pool.query('SELECT id, name, email FROM senders ORDER BY created_at');
  return rows;
}

export async function sendMail(
  sender: Sender,
  msg: { to: string; subject: string; html: string },
): Promise<SendResult> {
  const info = await getTransporter(sender).sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
  });
  const preview = config.mailMode === 'ethereal' ? nodemailer.getTestMessageUrl(info) : false;
  return { messageId: info.messageId, previewUrl: preview || null };
}
