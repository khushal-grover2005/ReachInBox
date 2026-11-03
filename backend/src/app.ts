import 'dotenv/config';
import 'express-async-errors';
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { listMailSenders } from './mail.js';
import { emailQueue, redis } from './queue.js';
import { searchEmails } from './search.js';
import type { SessionUser } from './types.js';

const app = express();
app.set('trust proxy', 1);
const PgSession = connectPgSimple(session);
const sessionStore = new PgSession({ pool, createTableIfMissing: true });

app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(session({
  store: sessionStore,
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

const router = express.Router();
const emailSchema = z.string().email().transform((email) => email.trim().toLowerCase());

function authenticated(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ error: 'Sign in with Google to continue.' });
    return;
  }
  next();
}

function getUser(req: Request): SessionUser {
  if (!req.session.user) throw new Error('Authentication required');
  return req.session.user;
}

function oauthRequired(clientId: string, clientSecret: string, name: string, res: Response): boolean {
  if (clientId && clientSecret) return true;
  res.status(503).json({ error: `${name} OAuth is not configured. Set its client ID and secret in .env.` });
  return false;
}

router.get('/auth/google', async (_req, res) => {
  if (!config.googleClientId || !config.googleClientSecret) {
    res.redirect(`${config.frontendUrl}/?authError=google_config`);
    return;
  }
  const state = crypto.randomBytes(24).toString('hex');
  await redis.set(`oauth:google:${state}`, '1', 'EX', 600);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleCallbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  }).toString();
  res.redirect(url.toString());
});

router.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || typeof code !== 'string' || typeof state !== 'string') {
    res.redirect(`${config.frontendUrl}/?authError=google`);
    return;
  }
  const stateValue = await redis.getdel(`oauth:google:${state}`);
  if (!stateValue) {
    res.status(400).send('OAuth state expired. Please try again.');
    return;
  }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleCallbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  const token = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !token.access_token) {
    res.status(401).send(`Google sign-in failed: ${token.error ?? 'token exchange rejected'}`);
    return;
  }
  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const profile = await profileResponse.json() as { sub?: string; email?: string; name?: string; picture?: string; email_verified?: boolean };
  if (!profileResponse.ok || !profile.sub || !profile.email || !profile.email_verified) {
    res.status(401).send('Google did not return a verified email address.');
    return;
  }
  const { rows } = await pool.query<{ id: string; email: string; name: string; avatar_url: string | null }>(
    `INSERT INTO users (google_id, email, name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
     RETURNING id, email, name, avatar_url`,
    [profile.sub, profile.email.toLowerCase(), profile.name ?? profile.email, profile.picture ?? null],
  );
  const user = rows[0];
  req.session.user = { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url };
  req.session.save((saveError) => {
    if (saveError) {
      res.status(500).send('Could not establish a login session.');
      return;
    }
    res.redirect(config.frontendUrl);
  });
});

router.get('/auth/me', (req, res) => res.json({ user: req.session.user ?? null }));
router.get('/auth/config', (_req, res) => res.json({
  googleConfigured: Boolean(config.googleClientId && config.googleClientSecret),
}));
router.post('/auth/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('connect.sid');
    res.status(204).end();
  });
});

router.get('/senders', authenticated, (_req, res) => res.json({
  senders: listMailSenders(),
  maxHourlyLimit: config.maxEmailsPerHourPerSender,
  minSendIntervalMs: config.minSendIntervalMs,
}));

const scheduleSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  body: z.string().min(1).max(100_000),
  recipients: z.array(emailSchema).min(1).max(config.maxCampaignRecipients),
  senderId: z.string().min(1),
  startsAt: z.string().datetime({ offset: true }),
  delayBetweenEmailsMs: z.number().int().min(0).max(3_600_000),
  hourlyLimit: z.number().int().min(1).max(config.maxEmailsPerHourPerSender),
});

router.post('/emails/schedule', authenticated, async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid schedule request.' });
    return;
  }
  const sender = listMailSenders().find(({ id }) => id === parsed.data.senderId);
  if (!sender) {
    res.status(400).json({ error: 'Choose a configured sender.' });
    return;
  }
  const idempotencyKey = req.get('Idempotency-Key');
  if (!idempotencyKey || idempotencyKey.length > 200) {
    res.status(400).json({ error: 'An Idempotency-Key header is required.' });
    return;
  }
  const user = getUser(req);
  const recipients = [...new Set(parsed.data.recipients)];
  const startTime = new Date(parsed.data.startsAt);
  const delayMs = Math.max(parsed.data.delayBetweenEmailsMs, config.minSendIntervalMs);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO campaigns (user_id, idempotency_key, subject, body, sender_id, starts_at, delay_between_emails_ms, hourly_limit, recipient_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`,
      [user.id, idempotencyKey, parsed.data.subject, parsed.data.body, sender.id, startTime, delayMs, parsed.data.hourlyLimit, recipients.length],
    );
    let campaignId = inserted.rows[0]?.id;
    if (!campaignId) {
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM campaigns WHERE user_id = $1 AND idempotency_key = $2',
        [user.id, idempotencyKey],
      );
      campaignId = existing.rows[0]?.id;
      if (!campaignId) throw new Error('Could not resolve idempotent campaign');
    } else {
      await client.query(
        `INSERT INTO emails (campaign_id, user_id, recipient, subject, body, sender_id, scheduled_at)
         SELECT $1, $2, input.recipient, $3, $4, $5, $6::timestamptz + ((input.position - 1) * $7::integer) * interval '1 millisecond'
         FROM unnest($8::text[]) WITH ORDINALITY AS input(recipient, position)
         ON CONFLICT (campaign_id, recipient) DO NOTHING`,
        [campaignId, user.id, parsed.data.subject, parsed.data.body, sender.id, startTime, delayMs, recipients],
      );
    }
    const scheduled = await client.query<{
      id: string;
      user_id: string;
      recipient: string;
      subject: string;
      body: string;
      sender_id: string;
      status: string;
      scheduled_at: Date;
      sent_at: Date | null;
    }>(
      "SELECT id, user_id, recipient, subject, body, sender_id, status, scheduled_at, sent_at FROM emails WHERE campaign_id = $1 AND status = 'scheduled' ORDER BY scheduled_at, id",
      [campaignId],
    );
    await client.query('COMMIT');
    const { enqueueScheduledEmails } = await import('./queue.js');
    const rows = scheduled.rows;
    await enqueueScheduledEmails(rows.map((email) => ({ id: email.id, scheduledAt: new Date(email.scheduled_at) })));
    const { indexEmail } = await import('./search.js');
    await Promise.all(rows.map((email) => indexEmail({ ...email, scheduled_at: email.scheduled_at.toISOString(), sent_at: null })));
    res.status(202).json({ campaignId, scheduledCount: rows.length, sender: sender.email });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

router.get('/emails', authenticated, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'scheduled';
  const allowed = ['scheduled', 'sent', 'failed'];
  if (!allowed.includes(status)) {
    res.status(400).json({ error: 'status must be scheduled, sent, or failed.' });
    return;
  }
  const user = getUser(req);
  const statusClause = status === 'sent' ? "status IN ('sent', 'failed')" : 'status = $2';
  const parameters = status === 'sent' ? [user.id] : [user.id, status];
  const { rows } = await pool.query(
    `SELECT id, recipient, subject, sender_id, scheduled_at, sent_at, status, error_message
     FROM emails WHERE user_id = $1 AND ${statusClause} ORDER BY COALESCE(sent_at, scheduled_at) DESC LIMIT 500`,
    parameters,
  );
  res.json({ emails: rows });
});

router.get('/emails/search', authenticated, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 200) {
    res.status(400).json({ error: 'Search query must be between 2 and 200 characters.' });
    return;
  }
  res.json({ emails: await searchEmails(getUser(req).id, query) });
});

router.get('/slack/connect', authenticated, async (req, res) => {
  if (!oauthRequired(config.slackClientId, config.slackClientSecret, 'Slack', res)) return;
  const state = crypto.randomBytes(24).toString('hex');
  await redis.set(`oauth:slack:${state}`, getUser(req).id, 'EX', 600);
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.search = new URLSearchParams({
    client_id: config.slackClientId,
    user_scope: 'chat:write,im:write,users:read',
    redirect_uri: config.slackCallbackUrl,
    state,
  }).toString();
  res.redirect(url.toString());
});

router.get('/slack/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || typeof code !== 'string' || typeof state !== 'string') {
    res.redirect(`${config.frontendUrl}/?slackError=oauth`);
    return;
  }
  const userId = await redis.getdel(`oauth:slack:${state}`);
  if (!userId) {
    res.status(400).send('Slack OAuth state expired. Please reconnect.');
    return;
  }
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.slackClientId,
      client_secret: config.slackClientSecret,
      redirect_uri: config.slackCallbackUrl,
    }),
  });
  const result = await response.json() as {
    ok: boolean;
    team?: { id: string };
    authed_user?: { id: string; access_token?: string };
    error?: string;
  };
  if (!result.ok || !result.team?.id || !result.authed_user?.id || !result.authed_user.access_token) {
    res.status(401).send(`Slack connection failed: ${result.error ?? 'token exchange rejected'}`);
    return;
  }
  await pool.query(
    `INSERT INTO slack_integrations (user_id, team_id, slack_user_id, access_token)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET team_id = EXCLUDED.team_id, slack_user_id = EXCLUDED.slack_user_id, access_token = EXCLUDED.access_token, connected_at = now()`,
    [userId, result.team.id, result.authed_user.id, result.authed_user.access_token],
  );
  res.redirect(`${config.frontendUrl}/?slackConnected=1`);
});

router.get('/slack/status', authenticated, async (req, res) => {
  const { rows } = await pool.query<{ connected_at: Date }>(
    'SELECT connected_at FROM slack_integrations WHERE user_id = $1',
    [getUser(req).id],
  );
  res.json({ connected: Boolean(rows[0]), connectedAt: rows[0]?.connected_at ?? null });
});

router.post('/slack/disconnect', authenticated, async (req, res) => {
  await pool.query('DELETE FROM slack_integrations WHERE user_id = $1', [getUser(req).id]);
  res.status(204).end();
});

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  await redis.ping();
  res.json({ status: 'ok' });
});

app.use('/api', router);
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
app.use('/admin/queues', (req, res, next) => {
  if (config.queueDashboardPassword) {
    const authorization = req.get('authorization') ?? '';
    const [scheme, encoded] = authorization.split(' ');
    const expected = Buffer.from(`admin:${config.queueDashboardPassword}`);
    const supplied = Buffer.from(scheme === 'Basic' ? Buffer.from(encoded ?? '', 'base64').toString() : '');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.status(401).send('Authentication required');
      return;
    }
    next();
    return;
  }
  authenticated(req, res, next);
}, serverAdapter.getRouter());

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  if (!res.headersSent) res.status(500).json({ error: 'Unexpected server error.' });
});

export { app };
