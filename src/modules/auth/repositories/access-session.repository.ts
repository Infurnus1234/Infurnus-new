import { pool } from '../../../infrastructure/database/postgres.js';

/** A rotated refresh row is not a logout: the family must still have a live row. */
export async function activeAccessSession(userId: string, familyId: string, role: string) {
  const result = await pool.query(
    `SELECT 1 FROM refresh_tokens r JOIN users u ON u.id=r.user_id
     WHERE r.user_id=$1 AND r.family_id=$2 AND r.revoked_at IS NULL
       AND r.expires_at>clock_timestamp() AND u.deleted_at IS NULL
       AND u.status='active' AND u.role::text=$3 LIMIT 1`,
    [userId, familyId, role],
  );
  return result.rowCount === 1;
}
