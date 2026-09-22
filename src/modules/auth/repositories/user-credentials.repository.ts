import { pool } from '../../../infrastructure/database/postgres.js';

export interface UserCredentialsRepository {
  create(userId: string, passwordHash: string): Promise<void>;

  findPasswordHashByUserId(userId: string): Promise<string | null>;

  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
}

export class PostgresUserCredentialsRepository implements UserCredentialsRepository {
  async create(userId: string, passwordHash: string): Promise<void> {
    await pool.query(
      `
        INSERT INTO user_credentials (
          user_id,
          password_hash
        )
        VALUES ($1, $2)
      `,
      [userId, passwordHash],
    );
  }

  async findPasswordHashByUserId(userId: string): Promise<string | null> {
    const result = await pool.query<{ passwordHash: string }>(
      `
        SELECT
          password_hash AS "passwordHash"
        FROM user_credentials
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId],
    );

    return result.rows[0]?.passwordHash ?? null;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    const result = await pool.query(
      `
        UPDATE user_credentials
        SET password_hash = $2
        WHERE user_id = $1
      `,
      [userId, passwordHash],
    );

    if (result.rowCount !== 1) {
      throw new Error('User credentials not found');
    }
  }
}
