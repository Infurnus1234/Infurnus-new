import { pool } from '../../../infrastructure/database/postgres.js';

export interface UserCredentialsRepository {
  create(userId: string, passwordHash: string): Promise<void>;

  findPasswordHashByUserId(userId: string): Promise<string | null>;
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
}
