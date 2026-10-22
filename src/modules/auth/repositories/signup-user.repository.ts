import { pool } from '../../../infrastructure/database/postgres.js';

export interface SignupUserRepository {
  existsByEmail(email: string, role?: string): Promise<boolean>;
  existsByPhone(phone: string, role?: string): Promise<boolean>;
}

export class PostgresSignupUserRepository implements SignupUserRepository {
  async existsByEmail(email: string, role?: string): Promise<boolean> {
    const result = await pool.query(
      `
        SELECT 1
        FROM users
        WHERE lower(btrim(email)) = lower(btrim($1))
          AND ($2::text IS NULL OR role::text=$2)
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [email, role ?? null],
    );

    return result.rowCount === 1;
  }

  async existsByPhone(phone: string, role?: string): Promise<boolean> {
    const result = await pool.query(
      `
        SELECT 1
        FROM users
        WHERE ltrim(btrim(phone), '+') = ltrim(btrim($1), '+')
          AND ($2::text IS NULL OR role::text=$2)
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [phone, role ?? null],
    );

    return result.rowCount === 1;
  }
}
