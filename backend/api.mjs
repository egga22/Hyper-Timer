import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';

const WRITABLE = new Set(['timers', 'last_modified', 'Settings', 'preferences']);
const AUTH_ROUTES = new Set(['/auth/sign-in/email', '/auth/sign-up/email', '/auth/sign-out', '/auth/get-session', '/auth/change-password']);
export function validatePatch(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || !Object.keys(body).length) throw new Error('Invalid update');
  if (Object.keys(body).some(k => !WRITABLE.has(k))) throw new Error('Protected or unknown field');
  if ('timers' in body && !Array.isArray(body.timers)) throw new Error('Invalid timers');
  for (const key of ['Settings', 'preferences']) if (key in body && (!body[key] || typeof body[key] !== 'object' || Array.isArray(body[key]))) throw new Error('Invalid settings');
  if ('last_modified' in body && (typeof body.last_modified !== 'string' || !Number.isFinite(Date.parse(body.last_modified)))) throw new Error('Invalid timestamp');
  return body;
}
export function safeAccount(row) {
  // Explicit allowlist: legacy data may contain other sensitive fields.
  return { _id: row.legacy_id, email: row.email_original, Role: row.role_original,
    timers: row.payload.timers ?? [], Settings: row.payload.Settings ?? row.payload.settings ?? row.payload.preferences,
    preferences: row.payload.preferences, last_modified: row.payload.last_modified, revision: String(row.revision) };
}
export function createApp({ pool, auth, origins, signupsEnabled = false }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !origins.includes(origin)) return c.json({ error: 'Origin not allowed' }, 403);
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.use('*', cors({ origin: origins, allowHeaders: ['Content-Type', 'Authorization', 'If-Match'], exposeHeaders: ['set-auth-token'], allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'] }));
  app.use('*', bodyLimit({ maxSize: 20 * 1024 * 1024, onError: c => c.json({ error: 'Account payload too large' }, 413) }));
  app.get('/health', c => c.json({ ok: true }));
  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next();
    const { rows } = await pool.query('SELECT ready FROM migration_state WHERE id = true');
    if (!rows[0]?.ready) return c.json({ error: 'Cloud service is being prepared. Local timers remain available.' }, 503);
    await next();
  });
  app.all('/auth/*', async c => {
    if (!AUTH_ROUTES.has(c.req.path)) return c.json({ error: 'Not found' }, 404);
    if (c.req.path === '/auth/sign-up/email' && !signupsEnabled) return c.json({ error: 'Signup is temporarily unavailable' }, 503);
    const response = await auth.handler(c.req.raw);
    return response;
  });
  app.use('/account', async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Please log in' }, 401);
    c.set('userId', session.user.id);
    await next();
  });
  app.get('/account', async c => {
    const { rows } = await pool.query('SELECT * FROM timer_accounts WHERE user_id = $1', [c.get('userId')]);
    if (!rows[0]) {
      // A new authenticated signup gets Standard only. Existing imports always have a row.
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      await pool.query(`INSERT INTO timer_accounts(user_id,legacy_id,email_original,role_original,payload)
        VALUES($1,$1,$2,'"Standard"'::jsonb,'{"timers":[]}'::jsonb) ON CONFLICT DO NOTHING`, [c.get('userId'), session.user.email]);
      const result = await pool.query('SELECT * FROM timer_accounts WHERE user_id = $1', [c.get('userId')]);
      return c.json(safeAccount(result.rows[0]));
    }
    return c.json(safeAccount(rows[0]));
  });
  app.patch('/account', async c => {
    let body;
    try { body = validatePatch(await c.req.json()); } catch { return c.json({ error: 'Invalid update or protected field' }, 400); }
    const revision = c.req.header('if-match');
    if (!revision || !/^\d+$/.test(revision)) return c.json({ error: 'Sync before saving' }, 428);
    const { rows } = await pool.query(`UPDATE timer_accounts SET payload = payload || $2::jsonb, revision = revision + 1, updated_at = now()
      WHERE user_id = $1 AND revision = $3::bigint RETURNING *`, [c.get('userId'), JSON.stringify(body), revision]);
    if (!rows[0]) return c.json({ error: 'Cloud data changed. Sync before saving again.' }, 409);
    return c.json(safeAccount(rows[0]));
  });
  app.onError((_error, c) => c.json({ error: 'Cloud request failed. Your local data is retained.' }, 500));
  return app;
}
