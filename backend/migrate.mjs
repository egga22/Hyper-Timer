// Run only on a trusted machine. Never upload exports or .env files to static hosting.
import pg from 'pg';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from './auth.mjs';
import { fileURLToPath } from 'node:url';

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function prepareRecords(records) {
  if (!Array.isArray(records) || !records.length) throw new Error('Empty or invalid export; refusing migration');
  const ids = new Set(), emails = new Set();
  return records.map(record => {
    if (!record._id || typeof record.email !== 'string' || typeof record.password !== 'string' || !record.password.length) throw new Error('Missing account identity or password; manual review required');
    const email = record.email.trim().toLowerCase();
    if (!email.includes('@') || ids.has(record._id) || emails.has(email)) throw new Error('Duplicate or invalid account identity; manual review required');
    ids.add(record._id); emails.add(email);
    const { password, ...payload } = record;
    const role = record.Role ?? record.role ?? 'Standard';
    return { id: String(record._id), email, originalEmail: record.email, password, role, payload,
      digest: createHash('sha256').update(canonical(payload)).digest('hex') };
  });
}
async function exportRestdb(file) {
  if (!process.env.RESTDB_API_KEY || !process.env.RESTDB_URL) throw new Error('RESTDB_API_KEY and RESTDB_URL required');
  const records = [];
  for (let skip = 0;; skip += 100) {
    const url = new URL(process.env.RESTDB_URL);
    url.searchParams.set('max', '100'); url.searchParams.set('skip', String(skip)); url.searchParams.set('sort', '_id'); url.searchParams.set('dir', '1');
    const response = await fetch(url, { headers: { 'x-apikey': process.env.RESTDB_API_KEY } });
    if (!response.ok) throw new Error(`RestDB export failed (${response.status}); no export accepted`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Unexpected RestDB export format');
    records.push(...batch);
    if (batch.length < 100) break;
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  prepareRecords(records);
  await mkdir('.private', { recursive: true, mode: 0o700 });
  // Never silently replace a previous backup.
  await writeFile(file, JSON.stringify(records), { mode: 0o600, flag: 'wx' });
  console.log(`Exported ${records.length} accounts to private backup. No account contents logged.`);
}
async function main() {
  const [command, file = '.private/restdb-accounts.json'] = process.argv.slice(2);
  if (command === 'export') return exportRestdb(file);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    if (command === 'init') {
      const auth = createAuth(pool, process.env);
      const { runMigrations } = await getMigrations(auth.options);
      await runMigrations();
      await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
      console.log('Auth and application schema initialized; service remains closed until verification and activation.');
      return;
    }
    const records = prepareRecords(JSON.parse(await readFile(file, 'utf8')));
    if (command === 'import') {
      // All validation and expensive hashing happens before the transaction.
      const hashed = [];
      for (const record of records) hashed.push({ ...record, hash: await hashPassword(record.password) });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const state = await client.query('SELECT ready FROM migration_state WHERE id = true FOR UPDATE');
        if (state.rows[0]?.ready) throw new Error('Target is live; refusing overwrite');
        const changed = await client.query('SELECT count(*)::int AS count FROM timer_accounts WHERE revision <> 1');
        if (changed.rows[0].count) throw new Error('Target contains application writes; refusing overwrite');
        for (const r of hashed) {
          const existing = await client.query('SELECT id,email FROM "user" WHERE id=$1 OR lower(email)=$2', [r.id, r.email]);
          if (existing.rows.some(u => u.id !== r.id || u.email !== r.email)) throw new Error('Identity collision; refusing overwrite');
          await client.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now()) ON CONFLICT(id) DO NOTHING`, [r.id, r.originalEmail, r.email]);
          await client.query(`INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,'credential',$2,$3,now(),now())
            ON CONFLICT(id) DO UPDATE SET password=EXCLUDED.password,"updatedAt"=now()`, ['legacy-' + r.id, r.id, r.hash]);
          await client.query(`INSERT INTO timer_accounts(user_id,legacy_id,email_original,role_original,payload,source_digest) VALUES($1,$1,$2,$3::jsonb,$4::jsonb,$5)
            ON CONFLICT(user_id) DO UPDATE SET email_original=EXCLUDED.email_original,role_original=EXCLUDED.role_original,payload=EXCLUDED.payload,source_digest=EXCLUDED.source_digest`, [r.id, r.originalEmail, JSON.stringify(r.role), JSON.stringify(r.payload), r.digest]);
        }
        await client.query('UPDATE migration_state SET imported_at=now(),verified_at=NULL WHERE id=true');
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      console.log(`Imported ${records.length} accounts; passwords hashed without changing login passwords. Service remains closed.`);
      return;
    }
    if (!['verify', 'activate'].includes(command)) throw new Error('Use init, export, import, verify, or activate');
    const result = await pool.query(`SELECT t.*,a.password FROM timer_accounts t JOIN account a ON a."userId"=t.user_id AND a."providerId"='credential'`);
    if (result.rows.length !== records.length) throw new Error('Account count mismatch');
    for (const r of records) {
      const row = result.rows.find(row => row.legacy_id === r.id);
      if (!row || row.user_id !== r.id || row.email_original !== r.originalEmail || canonical(row.role_original) !== canonical(r.role) || canonical(row.payload) !== canonical(r.payload) || row.source_digest !== r.digest) throw new Error('Account data or role mismatch');
      if (!await verifyPassword({ hash: row.password, password: r.password })) throw new Error('Password verification mismatch');
    }
    await pool.query('UPDATE migration_state SET verified_at=now() WHERE id=true');
    if (command === 'activate') {
      if (process.env.SOURCE_WRITES_FROZEN !== 'yes') throw new Error('Freeze RestDB writes and take final export before activation; SOURCE_WRITES_FROZEN=yes required');
      await pool.query('UPDATE migration_state SET ready=true WHERE id=true');
    }
    console.log(`Verified ${records.length} accounts: exact roles, full non-password payloads, IDs, emails, and every unchanged login password. ${command === 'activate' ? 'Service activated.' : 'Service remains in its existing state.'}`);
  } finally { await pool.end(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Migration failed safely. Review configuration, identities and data privately; no account details logged.'); process.exitCode = 1; });
