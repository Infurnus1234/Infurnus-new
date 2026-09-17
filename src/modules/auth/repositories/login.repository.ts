import { pool } from '../../../infrastructure/database/postgres.js';

// ============================================================
// Login Identity
// ============================================================

export interface LoginIdentity {
  id: string;
  role: string;
  status: 'active' | 'suspended' | 'banned';

  /**
   * Email and phone are nullable because a user may
   * authenticate using either contact method.
   */
  email: string | null;
  phone: string | null;

  passwordHash: string;
}

// ============================================================
// Repository Contract
// ============================================================

export interface LoginRepository {
  findByEmail(email: string): Promise<LoginIdentity | null>;
  findByPhone(phone: string): Promise<LoginIdentity | null>;
}

// ============================================================
// PostgreSQL Implementation
// ============================================================

export class PostgresLoginRepository implements LoginRepository {
  // ==========================================================
  // Find user by email
  // ==========================================================

  async findByEmail(email: string): Promise<LoginIdentity | null> {
    const result = await pool.query<LoginIdentity>(
      `
        SELECT
          u.id,
          u.role,
          u.status,
          u.email,
          u.phone,
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

  // ==========================================================
  // Find user by phone
  // ==========================================================

  async findByPhone(phone: string): Promise<LoginIdentity | null> {
    const result = await pool.query<LoginIdentity>(
      `
        SELECT
          u.id,
          u.role,
          u.status,
          u.email,
          u.phone,
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
