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
  provisionedEmailEligible?: boolean;
  provisionedPhoneEligible?: boolean;
  phoneVerified?: boolean;
  lockedUntil?: Date | null;
}

// ============================================================
// Repository Contract
// ============================================================

export interface LoginRepository {
  findByEmail(email: string, role?: string, providerOnly?: boolean): Promise<LoginIdentity | null>;
  findByPhone(phone: string, role?: string, providerOnly?: boolean): Promise<LoginIdentity | null>;
}

// ============================================================
// PostgreSQL Implementation
// ============================================================

export class PostgresLoginRepository implements LoginRepository {
  // A saved Fleet's provisioned contact can prove ownership before business
  // approval. This authenticates the existing Driver; it grants no driving rights.
  // ==========================================================
  // Find user by email
  // ==========================================================

  async findByEmail(
    email: string,
    role?: string,
    providerOnly = false,
  ): Promise<LoginIdentity | null> {
    const result = await pool.query<LoginIdentity>(
      `
        SELECT
          u.id,
          u.role,
          u.status,
          u.email,
          u.phone,
          EXISTS(SELECT 1 FROM fleet_managed_driver_accounts m
            JOIN partners p ON p.id=m.partner_id JOIN users owner ON owner.id=p.user_id
            WHERE m.driver_user_id=u.id AND m.status='ACTIVE' AND u.role='driver'
              AND owner.status='active' AND owner.deleted_at IS NULL
              AND owner.role IN ('fleet_owner','driver_fleet_owner')
              AND m.provisioned_email=lower(btrim(u.email))) AS "provisionedEmailEligible",
          EXISTS(SELECT 1 FROM fleet_managed_driver_accounts m
            JOIN partners p ON p.id=m.partner_id JOIN users owner ON owner.id=p.user_id
            WHERE m.driver_user_id=u.id AND m.status='ACTIVE' AND u.role='driver'
              AND owner.status='active' AND owner.deleted_at IS NULL
              AND owner.role IN ('fleet_owner','driver_fleet_owner')
              AND ltrim(m.provisioned_phone,'+')=ltrim(btrim(u.phone),'+')) AS "provisionedPhoneEligible",
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
          AND (NOT $3::boolean OR u.role IN ('driver','fleet_owner','driver_fleet_owner'))
          AND u.deleted_at IS NULL

        LIMIT 2
      `,
      [email, role ?? null, providerOnly],
    );

    if (result.rows.length > 1)
      throw new AppError('ACCOUNT_ROLE_REQUIRED', 'Specify the account role to sign in', 409);
    return result.rows[0] ?? null;
  }

  // ==========================================================
  // Find user by phone
  // ==========================================================

  async findByPhone(
    phone: string,
    role?: string,
    providerOnly = false,
  ): Promise<LoginIdentity | null> {
    const result = await pool.query<LoginIdentity>(
      `
        SELECT
          u.id,
          u.role,
          u.status,
          u.email,
          u.phone,
          EXISTS(SELECT 1 FROM fleet_managed_driver_accounts m
            JOIN partners p ON p.id=m.partner_id JOIN users owner ON owner.id=p.user_id
            WHERE m.driver_user_id=u.id AND m.status='ACTIVE' AND u.role='driver'
              AND owner.status='active' AND owner.deleted_at IS NULL
              AND owner.role IN ('fleet_owner','driver_fleet_owner')
              AND m.provisioned_email=lower(btrim(u.email))) AS "provisionedEmailEligible",
          EXISTS(SELECT 1 FROM fleet_managed_driver_accounts m
            JOIN partners p ON p.id=m.partner_id JOIN users owner ON owner.id=p.user_id
            WHERE m.driver_user_id=u.id AND m.status='ACTIVE' AND u.role='driver'
              AND owner.status='active' AND owner.deleted_at IS NULL
              AND owner.role IN ('fleet_owner','driver_fleet_owner')
              AND ltrim(m.provisioned_phone,'+')=ltrim(btrim(u.phone),'+')) AS "provisionedPhoneEligible",
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
          AND (NOT $3::boolean OR u.role IN ('driver','fleet_owner','driver_fleet_owner'))
          AND u.deleted_at IS NULL

        LIMIT 2
      `,
      [phone, role ?? null, providerOnly],
    );

    // Legacy aliases must never silently select or link different accounts.
    if (result.rows.length > 1)
      throw new AppError('ACCOUNT_ROLE_REQUIRED', 'Specify the account role to sign in', 409);
    return result.rows[0] ?? null;
  }
}
