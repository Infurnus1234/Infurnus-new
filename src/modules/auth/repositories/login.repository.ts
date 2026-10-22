import { AppError } from '../../../common/errors/app-error.js';
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
  findByEmail(email: string, role?: string): Promise<LoginIdentity | null>;
  findByPhone(phone: string, role?: string): Promise<LoginIdentity | null>;
}

// ============================================================
// PostgreSQL Implementation
// ============================================================

export class PostgresLoginRepository implements LoginRepository {
  // ==========================================================
  // Find user by email
  // ==========================================================

  async findByEmail(email: string, role?: string): Promise<LoginIdentity | null> {
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
        WHERE lower(btrim(u.email)) = lower(btrim($1))
          AND ($2::text IS NULL OR u.role::text=$2)
          AND u.deleted_at IS NULL

        LIMIT 2
      `,
      [email, role ?? null],
    );

    if (result.rows.length > 1)
      throw new AppError('ACCOUNT_ROLE_REQUIRED', 'Specify the account role to sign in', 409);
    return result.rows[0] ?? null;
  }

  // ==========================================================
  // Find user by phone
  // ==========================================================

  async findByPhone(phone: string, role?: string): Promise<LoginIdentity | null> {
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
        WHERE ltrim(btrim(u.phone), '+') = ltrim(btrim($1), '+')
          AND ($2::text IS NULL OR u.role::text=$2)
          AND u.deleted_at IS NULL

        LIMIT 2
      `,
      [phone, role ?? null],
    );

    // Legacy aliases must never silently select or link different accounts.
    if (result.rows.length > 1)
      throw new AppError('ACCOUNT_ROLE_REQUIRED', 'Specify the account role to sign in', 409);
    return result.rows[0] ?? null;
  }
}
