import type { Pool } from 'pg';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { normalizeEmail } from '../utils/contact.js';

// Operator-only utility. It is never exposed through public signup or HTTP.
export async function provisionAdministrativeAccount(
  database: Pool,
  input: {
    email: string;
    password: string;
    role: 'admin' | 'super_admin';
    firstName: string;
    lastName: string;
  },
) {
  const email = normalizeEmail(input.email);
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !input.password ||
    !['admin', 'super_admin'].includes(input.role)
  )
    throw new Error('Invalid administrative provisioning input');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`admin-provision:${email}`]);
    const existing = await client.query<{
      id: string;
      role: string;
      status: string;
      deleted_at: Date | null;
    }>('SELECT id,role,status,deleted_at FROM users WHERE lower(btrim(email))=$1 FOR UPDATE', [
      email,
    ]);
    if (existing.rows.length > 1)
      throw new Error('Duplicate identities require an explicit reconciliation plan');
    const account = existing.rows[0];
    if (account) {
      if (account.deleted_at || account.status !== 'active' || account.role !== input.role)
        throw new Error(
          'Existing identity requires explicit status/role reconciliation; no changes made',
        );
      const credentials = await client.query<{ password_hash: string }>(
        'SELECT password_hash FROM user_credentials WHERE user_id=$1',
        [account.id],
      );
      const hash = credentials.rows[0]?.password_hash;
      if (!hash || !(await verifyPassword(hash, input.password)))
        throw new Error('Existing credentials differ; use the authorized password reset process');
      await client.query('COMMIT');
      return { id: account.id, role: account.role, created: false };
    }
    const hash = await hashPassword(input.password);
    const created = await client.query<{ id: string }>(
      "INSERT INTO users(first_name,last_name,email,phone,role,status) VALUES($1,$2,$3,NULL,$4,'active') RETURNING id",
      [input.firstName, input.lastName, email, input.role],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error('Account creation returned no identity');
    await client.query('INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)', [
      id,
      hash,
    ]);
    await client.query(
      "INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,'ADMIN_ACCOUNT_PROVISIONED','USER',$1,$2::jsonb)",
      [id, JSON.stringify({ role: input.role, source: 'authorized-operator' })],
    );
    await client.query('COMMIT');
    return { id, role: input.role, created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
