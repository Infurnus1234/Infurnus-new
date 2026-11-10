import type { Pool } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';

export class ProviderIdentityRepository {
  constructor(private readonly pool: Pool) {}
  async lookup(publicId: string, actorId: string) {
    // A public number never grants access. Only self/linked identities or staff can resolve it.
    const result = await this.pool.query(
      `SELECT i.public_id AS "publicId", a.user_id AS "userId" FROM provider_identities i
       JOIN provider_identity_accounts a ON a.identity_id=i.id JOIN users u ON u.id=a.user_id
       WHERE i.public_id=$1 AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM users actor
        WHERE actor.id=$2 AND actor.status='active' AND actor.deleted_at IS NULL AND
        (actor.role IN ('admin','super_admin') OR EXISTS(SELECT 1 FROM provider_identity_accounts mine WHERE mine.user_id=actor.id AND mine.identity_id=i.id)))`,
      [publicId, actorId],
    );
    if (!result.rowCount) throw new AppError('PROVIDER_NOT_FOUND', 'Provider not found', 404);
    return result.rows;
  }
  async capacity() {
    return (await this.pool.query('SELECT * FROM provider_id_capacity')).rows[0];
  }
  async activateLength(width: number, actorId: string) {
    await this.pool.query('SELECT activate_provider_id_length($1,$2)', [width, actorId]);
    return this.capacity();
  }
  // Called only after BOTH current, session-bound access tokens have been verified.
  // Linking shares a public identity; it does not grant access to the other account's resources.
  async linkVerified(accountId: string, otherId: string, evidence: string) {
    if (accountId === otherId)
      throw new AppError('INVALID_LINK', 'Choose a different account', 400);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const accounts = await client.query(
        `SELECT id,role FROM users WHERE id=ANY($1::uuid[]) AND role IN ('driver','fleet_owner','driver_fleet_owner')
         AND status='active' AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [[accountId, otherId]],
      );
      if (accounts.rowCount !== 2)
        throw new AppError('INVALID_LINK', 'Two active provider accounts are required', 409);
      const memberships = await client.query<{ account_id: string; identity_id: string }>(
        'SELECT account_id,identity_id FROM provider_identity_accounts WHERE account_id=ANY($1::uuid[])',
        [[accountId, otherId]],
      );
      if (new Set(memberships.rows.map((r) => r.identity_id)).size > 1)
        throw new AppError(
          'ISSUED_IDENTITY_CONFLICT',
          'Both accounts already have permanent IDs. Reviewed reconciliation is required; issued IDs cannot be replaced.',
          409,
        );
      const canonical = memberships.rows[0]?.account_id ?? accountId;
      const result = await client.query<{ publicId: string }>(
        `SELECT ensure_provider_identity($1,'verified_link',NULL,$2::uuid[]) AS "publicId"`,
        [canonical, [accountId, otherId]],
      );
      await client.query(
        `INSERT INTO provider_identity_accounts(account_id,user_id,identity_id,evidence)
         SELECT u.id,u.id,a.identity_id,$3 FROM users u CROSS JOIN provider_identity_accounts a
         WHERE a.account_id=$1 AND u.id=ANY($2::uuid[]) ON CONFLICT(account_id) DO NOTHING`,
        [canonical, [accountId, otherId], evidence],
      );
      await client.query(
        'UPDATE provider_identity_reconciliation SET reviewed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE account_id=ANY($1::uuid[])',
        [[accountId, otherId]],
      );
      await client.query(
        `INSERT INTO provider_identity_audit(event,account_id,actor_id,details)
        VALUES('verified_alias',$1,$2,jsonb_build_object('canonicalAccount',$3::text,'evidence',$4::text))`,
        [otherId, accountId, canonical, evidence],
      );
      await client.query('COMMIT');
      return { publicId: result.rows[0]!.publicId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
