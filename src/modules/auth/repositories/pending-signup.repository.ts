import { AppError } from '../../../common/errors/app-error.js';
import { pool } from '../../../infrastructure/database/postgres.js';

import type { CreatePendingSignupData, PendingSignup } from '../types/signup.js';

// ============================================================
// Repository contract
// ============================================================

export interface PendingSignupRepository {
  create(data: CreatePendingSignupData): Promise<PendingSignup>;

  findById(id: string): Promise<PendingSignup | null>;

  findByContact(contactType: string, contactValue: string): Promise<PendingSignup | null>;

  incrementOtpAttempts(id: string): Promise<void>;

  markOtpVerified(id: string): Promise<void>;

  /**
   * Atomically replaces the OTP only when the resend cooldown
   * has elapsed.
   *
   * Returns true when the row was updated.
   * Returns false when the cooldown prevented the update or
   * the signup is no longer eligible for resend.
   */
  resendOtpIfCooldownElapsed(
    id: string,
    otpHash: string,
    otpExpiresAt: Date,
    cooldownSeconds: number,
  ): Promise<boolean>;

  deleteById(id: string): Promise<void>;
}

// ============================================================
// PostgreSQL implementation
// ============================================================

export class PostgresPendingSignupRepository implements PendingSignupRepository {
  // ----------------------------------------------------------
  // Create pending signup
  // ----------------------------------------------------------

  async create(data: CreatePendingSignupData): Promise<PendingSignup> {
    try {
      const result = await pool.query<PendingSignup>(
        `
          INSERT INTO pending_signups (
            first_name,
            last_name,
            contact_type,
            contact_value,
            password_hash,
            role,
            otp_hash,
            otp_expires_at,
            otp_attempts,
            last_otp_sent_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            0,
            NOW()
          )
          RETURNING
            id,
            first_name AS "firstName",
            last_name AS "lastName",
            contact_type AS "contactType",
            contact_value AS "contactValue",
            password_hash AS "passwordHash",
            role,
            otp_hash AS "otpHash",
            otp_expires_at AS "otpExpiresAt",
            otp_attempts AS "otpAttempts",
            otp_verified_at AS "otpVerifiedAt",
            last_otp_sent_at AS "lastOtpSentAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `,
        [
          data.firstName,
          data.lastName,
          data.contactType,
          data.contactValue,
          data.passwordHash,
          data.role,
          data.otpHash,
          data.otpExpiresAt,
        ],
      );

      const pendingSignup = result.rows[0];

      if (!pendingSignup) {
        throw new AppError('SIGNUP_CREATION_FAILED', 'Failed to create pending signup', 500);
      }

      return pendingSignup;
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new AppError(
          'SIGNUP_ALREADY_PENDING',
          'A signup is already pending for this contact',
          409,
        );
      }

      throw error;
    }
  }

  // ----------------------------------------------------------
  // Find by ID
  // ----------------------------------------------------------

  async findById(id: string): Promise<PendingSignup | null> {
    const result = await pool.query<PendingSignup>(
      `
        SELECT
          id,
          first_name AS "firstName",
          last_name AS "lastName",
          contact_type AS "contactType",
          contact_value AS "contactValue",
          password_hash AS "passwordHash",
          role,
          otp_hash AS "otpHash",
          otp_expires_at AS "otpExpiresAt",
          otp_attempts AS "otpAttempts",
          otp_verified_at AS "otpVerifiedAt",
          last_otp_sent_at AS "lastOtpSentAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM pending_signups
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );

    return result.rows[0] ?? null;
  }

  // ----------------------------------------------------------
  // Find by contact
  // ----------------------------------------------------------

  async findByContact(contactType: string, contactValue: string): Promise<PendingSignup | null> {
    const result = await pool.query<PendingSignup>(
      `
        SELECT
          id,
          first_name AS "firstName",
          last_name AS "lastName",
          contact_type AS "contactType",
          contact_value AS "contactValue",
          password_hash AS "passwordHash",
          role,
          otp_hash AS "otpHash",
          otp_expires_at AS "otpExpiresAt",
          otp_attempts AS "otpAttempts",
          otp_verified_at AS "otpVerifiedAt",
          last_otp_sent_at AS "lastOtpSentAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM pending_signups
        WHERE contact_type = $1
          AND contact_value = $2
        LIMIT 1
      `,
      [contactType, contactValue],
    );

    return result.rows[0] ?? null;
  }

  // ----------------------------------------------------------
  // Increment OTP attempts
  // ----------------------------------------------------------

  async incrementOtpAttempts(id: string): Promise<void> {
    await pool.query(
      `
        UPDATE pending_signups
        SET
          otp_attempts = otp_attempts + 1
        WHERE id = $1
          AND otp_verified_at IS NULL
      `,
      [id],
    );
  }

  // ----------------------------------------------------------
  // Mark OTP verified
  // ----------------------------------------------------------

  async markOtpVerified(id: string): Promise<void> {
    await pool.query(
      `
        UPDATE pending_signups
        SET
          otp_verified_at = NOW()
        WHERE id = $1
          AND otp_verified_at IS NULL
      `,
      [id],
    );
  }

  // ----------------------------------------------------------
  // Atomic OTP resend with cooldown
  // ----------------------------------------------------------

  async resendOtpIfCooldownElapsed(
    id: string,
    otpHash: string,
    otpExpiresAt: Date,
    cooldownSeconds: number,
  ): Promise<boolean> {
    const result = await pool.query(
      `
        UPDATE pending_signups
        SET
          otp_hash = $2,
          otp_expires_at = $3,
          otp_attempts = 0,
          last_otp_sent_at = NOW()
        WHERE id = $1
          AND otp_verified_at IS NULL
          AND last_otp_sent_at <=
              NOW() - ($4 * INTERVAL '1 second')
      `,
      [id, otpHash, otpExpiresAt, cooldownSeconds],
    );

    return result.rowCount === 1;
  }

  // ----------------------------------------------------------
  // Delete pending signup
  // ----------------------------------------------------------

  async deleteById(id: string): Promise<void> {
    await pool.query(
      `
        DELETE FROM pending_signups
        WHERE id = $1
      `,
      [id],
    );
  }
}
