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
  emailVerified?: boolean;
  phoneVerified?: boolean;
  lockedUntil?: Date | null;
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
          u.email_verified AS "emailVerified",
          u.phone_verified AS "phoneVerified",
          COALESCE(uc.password_hash, CASE WHEN u.role IN ('admin', 'super_admin') THEN ac.password_hash END) AS "passwordHash",
          ac.locked_until AS "lockedUntil"
        FROM users u
        LEFT JOIN user_credentials uc
          ON uc.user_id = u.id
        LEFT JOIN admin_credentials ac ON ac.user_id = u.id
        WHERE u.email = $1
          AND u.deleted_at IS NULL
          AND (u.role IN ('customer', 'driver') OR uc.password_hash IS NOT NULL OR (u.role IN ('admin', 'super_admin') AND ac.password_hash IS NOT NULL))
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
          u.email_verified AS "emailVerified",
          u.phone_verified AS "phoneVerified",
          COALESCE(uc.password_hash, CASE WHEN u.role IN ('admin', 'super_admin') THEN ac.password_hash END) AS "passwordHash",
          ac.locked_until AS "lockedUntil"
        FROM users u
        LEFT JOIN user_credentials uc
          ON uc.user_id = u.id
        LEFT JOIN admin_credentials ac ON ac.user_id = u.id
        WHERE ltrim(u.phone, '+') = ltrim($1, '+')
          AND u.deleted_at IS NULL
          AND (u.role IN ('customer', 'driver') OR uc.password_hash IS NOT NULL OR (u.role IN ('admin', 'super_admin') AND ac.password_hash IS NOT NULL))
        LIMIT 2
      `,
      [phone],
    );

    // Legacy aliases must never silently select or link different accounts.
    return result.rows.length === 1 ? result.rows[0]! : null;
  }
}
