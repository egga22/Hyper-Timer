import pg from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { createAuth } from './auth.mjs';
import { createApp } from './api.mjs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);
const auth = createAuth(pool, process.env);
export default createApp({ pool, auth, origins: process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()), signupsEnabled: process.env.SIGNUPS_ENABLED === 'true' });
