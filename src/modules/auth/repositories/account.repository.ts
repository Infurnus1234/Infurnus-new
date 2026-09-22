import { pool } from '../../../infrastructure/database/postgres.js';

export interface AccountRepository {
  findUserByEmail(email: string): Promise<{ id: string; email: string } | null>;

  updatePassword(userId: string, passwordHash: string): Promise<boolean>;

  softDelete(userId: string): Promise<boolean>;
}

export class PostgresAccountRepository implements AccountRepository {
  async findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
    const result = await pool.query<{ id: string; email: string }>(
      `SELECT id, email
       FROM users
       WHERE LOWER(email) = LOWER($1)
         AND deleted_at IS NULL
       LIMIT 1`,
      [email],
    );

    return result.rows[0] ?? null;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    const result = await pool.query(
      `UPDATE user_credentials
       SET password_hash = $1,
           updated_at = NOW()
       WHERE user_id = $2`,
      [passwordHash, userId],
    );

    return result.rowCount === 1;
  }

  async softDelete(userId: string): Promise<boolean> {
    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NOW()
       WHERE id = $1
         AND deleted_at IS NULL`,
      [userId],
    );

    return result.rowCount === 1;
  }
}
