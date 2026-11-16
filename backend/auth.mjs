import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';

export function createAuth(pool, env) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('Missing strong BETTER_AUTH_SECRET');
  if (!env.API_URL || !env.ALLOWED_ORIGINS) throw new Error('API_URL and ALLOWED_ORIGINS required');
  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.API_URL,
    basePath: '/auth',
    trustedOrigins: env.ALLOWED_ORIGINS.split(',').map(s => s.trim()),
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 1024, autoSignIn: false },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    plugins: [bearer()],
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 3 }, '/change-password': { window: 60, max: 5 } } },
    advanced: { useSecureCookies: !env.API_URL.startsWith('http://localhost'), database: { generateId: () => crypto.randomUUID() } },
    logger: { level: 'error' }
  });
}
