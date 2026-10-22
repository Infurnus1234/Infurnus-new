import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.port !== '5434' ||
  !/^admin_master_test_[a-f0-9]{32}$/.test(url.pathname.slice(1))
)
  throw new Error('Disposable audit database required');
const db = new Pool({ connectionString: url.toString() });
const c = await db.connect();
const up = await readFile('migrations/071_role_scoped_account_identities.sql', 'utf8');
const down = await readFile('docs/rollback/071_role_scoped_account_identities.sql', 'utf8');
const ids: string[] = [];
try {
  await c.query(down);
  const reverted = await c.query("SELECT to_regclass('users_email_active_uidx') AS global_index");
  if (!reverted.rows[0].global_index) throw new Error('Global uniqueness not restored');
  await c.query(up);
  const email = 'migration-' + randomUUID() + '@example.invalid',
    subject = randomUUID();
  for (const role of ['customer', 'driver']) {
    const r = await c.query(
      "INSERT INTO users(first_name,last_name,email,phone,role) VALUES('Migration','Fixture',$1,'+919000000001',$2) RETURNING id",
      [email, role],
    );
    ids.push(r.rows[0].id);
    await c.query(
      "INSERT INTO auth_external_identities(provider,provider_subject,user_id) VALUES('GOOGLE',$1,$2)",
      [subject, r.rows[0].id],
    );
  }
  let blocked = false;
  try {
    await c.query(down);
  } catch {
    blocked = true;
    await c.query('ROLLBACK');
  }
  if (!blocked) throw new Error('Unsafe rollback unexpectedly allowed shared identities');
  const kept = await c.query('SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[])', [
    ids,
  ]);
  if (kept.rows[0].n !== 2) throw new Error('Rollback guard did not preserve accounts');
  const mismatch = await c.query(
    'SELECT count(*)::int AS n FROM auth_external_identities WHERE user_id=ANY($1::uuid[])',
    [ids],
  );
  if (mismatch.rows[0].n !== 2) throw new Error('Rollback guard lost external identities');
  console.log(
    'Role migration rollback/reapply and shared-identity rollback refusal passed; records preserved.',
  );
} finally {
  await c.query('ROLLBACK');
  if (ids.length) await c.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
  c.release();
  await db.end();
}
