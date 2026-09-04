import { pool } from '../../../infrastructure/database/postgres.js';
import type { AuthUserIdentity } from '../types/auth-identity.js';

export interface AuthUserRepository {
  findIdentityById(userId: string): Promise<AuthUserIdentity | null>;
}

export class PostgresAuthUserRepository implements AuthUserRepository {
  async findIdentityById(userId: string): Promise<AuthUserIdentity | null> {
    const result = await pool.query<AuthUserIdentity>(
      `
        SELECT
          id,
          role,
          status
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [userId],
    );

    return result.rows[0] ?? null;
  }
}
