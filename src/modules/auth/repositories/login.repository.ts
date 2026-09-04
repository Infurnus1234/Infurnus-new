import { pool } from '../../../infrastructure/database/postgres.js';

export interface LoginIdentity {
  id: string;
  role: string;
  status: 'active' | 'suspended' | 'banned';
  passwordHash: string;
}

export interface LoginRepository {
  findByEmail(email: string): Promise<LoginIdentity | null>;
  findByPhone(phone: string): Promise<LoginIdentity | null>;
}

export class PostgresLoginRepository implements LoginRepository {
  async findByEmail(email: string): Promise<LoginIdentity | null> {
    const result = await pool.query<LoginIdentity>(
      `
        SELECT
          u.id,
          u.role,
          u.status,
          uc.password_hash AS "passwordHash"
        FROM users u
        INNER JOIN user_credentials uc
          ON uc.user_id = u.id
        WHERE u.email = $1
          AND u.deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    );

    return result.rows[0] ?? null;
  }

  async findByPhone(phone: string): Promise<LoginIdentity | null> {
    const result = await pool.query<LoginIdentity>(
      `
        SELECT
          u.id,
          u.role,
          u.status,
          uc.password_hash AS "passwordHash"
        FROM users u
        INNER JOIN user_credentials uc
          ON uc.user_id = u.id
        WHERE u.phone = $1
          AND u.deleted_at IS NULL
        LIMIT 1
      `,
      [phone],
    );

    return result.rows[0] ?? null;
  }
}
