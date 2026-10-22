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
    // Explicit operator reconciliation only; never supplied by a public HTTP route.
    reconciliation?: { expectedUserId: string; expectedRole: string; resetPassword: boolean };
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
    }>(
      'SELECT id,role,status,deleted_at FROM users WHERE lower(btrim(email))=$1 AND (($2::uuid IS NOT NULL AND id=$2) OR ($2::uuid IS NULL AND role::text=$3)) FOR UPDATE',
      [email, input.reconciliation?.expectedUserId ?? null, input.role],
    );
    if (existing.rows.length > 1)
      throw new Error('Duplicate identities require an explicit reconciliation plan');
    const account = existing.rows[0];
    if (!account && input.reconciliation)
      throw new Error('Expected identity is missing; reconciliation cannot create an account');
    if (account) {
      const repair = input.reconciliation;
      if (
        account.deleted_at ||
        account.status !== 'active' ||
        (repair &&
          (account.id !== repair.expectedUserId || account.role !== repair.expectedRole)) ||
        (!repair && account.role !== input.role)
      )
        throw new Error(
          'Existing identity requires explicit status/role reconciliation; no changes made',
        );
      const credentials = await client.query<{ password_hash: string }>(
        'SELECT password_hash FROM user_credentials WHERE user_id=$1',
        [account.id],
      );
      const hash = credentials.rows[0]?.password_hash;
      const passwordMatches = Boolean(hash && (await verifyPassword(hash, input.password)));
      if (!passwordMatches && !repair?.resetPassword)
        throw new Error('Existing credentials differ; use the authorized password reset process');
      if (repair) {
        const passwordHash = passwordMatches ? hash! : await hashPassword(input.password);
        await client.query('UPDATE users SET role=$2,email=$3 WHERE id=$1', [
          account.id,
          input.role,
          email,
        ]);
        await client.query(
          'INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash',
          [account.id, passwordHash],
        );
        await client.query(
          'INSERT INTO admin_credentials(user_id,password_hash) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,failed_login_attempts=0,locked_until=NULL',
          [account.id, passwordHash],
        );
        await client.query(
          'UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',
          [account.id],
        );
        await client.query(
          'UPDATE login_challenges SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL',
          [account.id],
        );
        await client.query(
          "INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata) VALUES($1,'ADMIN_ACCOUNT_RECONCILED','USER',$1,$2::jsonb)",
          [
            account.id,
            JSON.stringify({
              previousRole: account.role,
              role: input.role,
              passwordReset: !passwordMatches,
              source: 'authorized-operator',
            }),
          ],
        );
      }
      await client.query('COMMIT');
      return { id: account.id, role: input.role, created: false };
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
