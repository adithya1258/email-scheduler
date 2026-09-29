import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { config } from '../config';
import { pool } from '../db';
import { requireAuth, signToken } from '../middleware/auth';

const router = Router();
const googleClient = new OAuth2Client(config.googleClientId);

interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  password_hash?: string | null;
}

const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, avatarUrl: u.avatar_url });

function session(u: UserRow) {
  return { token: signToken({ id: u.id, email: u.email }), user: publicUser(u) };
}

interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

/** Verify a Google ID token (One Tap / GoogleLogin button). */
async function profileFromIdToken(idToken: string): Promise<GoogleProfile | null> {
  const ticket = await googleClient.verifyIdToken({ idToken, audience: config.googleClientId });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) return null;
  return { sub: p.sub, email: p.email, name: p.name ?? p.email, picture: p.picture ?? null };
}

/**
 * Verify an OAuth access token (custom-styled button via the implicit flow).
 * tokeninfo proves the token was issued to OUR client id before we trust userinfo.
 */
async function profileFromAccessToken(accessToken: string): Promise<GoogleProfile | null> {
  const info = await googleClient.getTokenInfo(accessToken);
  if (info.aud !== config.googleClientId && info.azp !== config.googleClientId) return null;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const u = (await r.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
  if (!u.email || !u.email_verified) return null;
  return { sub: u.sub, email: u.email, name: u.name ?? u.email, picture: u.picture ?? null };
}

// Google login: accepts either an ID token (`credential`) or an access token (`accessToken`).
router.post('/google', async (req, res) => {
  const body = z
    .object({ credential: z.string().min(10).optional(), accessToken: z.string().min(10).optional() })
    .refine((b) => b.credential || b.accessToken, 'credential or accessToken is required')
    .parse(req.body);
  if (!config.googleClientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID is not configured on the server' });

  let profile: GoogleProfile | null;
  try {
    profile = body.credential
      ? await profileFromIdToken(body.credential)
      : await profileFromAccessToken(body.accessToken!);
  } catch {
    profile = null;
  }
  if (!profile) return res.status(401).json({ error: 'Google sign-in could not be verified' });

  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, name, avatar_url, google_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, google_id = EXCLUDED.google_id
     RETURNING *`,
    [profile.email.toLowerCase(), profile.name, profile.picture, profile.sub],
  );
  res.json(session(rows[0]));
});

const credentialsSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(6).max(200),
  name: z.string().trim().max(100).optional(),
});

router.post('/register', async (req, res) => {
  const { email, password, name } = credentialsSchema.parse(req.body);
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING *`,
    [email, name || email.split('@')[0], hash],
  );
  if (!rows[0]) return res.status(409).json({ error: 'An account with this email already exists' });
  res.status(201).json(session(rows[0]));
});

router.post('/login', async (req, res) => {
  const { email, password } = credentialsSchema.parse(req.body);
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json(session(user));
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
  if (!rows[0]) return res.status(401).json({ error: 'User no longer exists' });
  res.json({ user: publicUser(rows[0]) });
});

export default router;
