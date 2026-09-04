import { pool } from '../../../infrastructure/database/postgres.js';

export interface SignupUserRepository {
  existsByEmail(email: string): Promise<boolean>;
  existsByPhone(phone: string): Promise<boolean>;
}

export class PostgresSignupUserRepository implements SignupUserRepository {
  async existsByEmail(email: string): Promise<boolean> {
    const result = await pool.query(
      `
        SELECT 1
        FROM users
        WHERE email = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    );

    return result.rowCount === 1;
  }

  async existsByPhone(phone: string): Promise<boolean> {
    const result = await pool.query(
      `
        SELECT 1
        FROM users
        WHERE phone = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [phone],
    );

    return result.rowCount === 1;
  }
}
