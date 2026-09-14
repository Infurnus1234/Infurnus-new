import { AppError } from '../../../common/errors/app-error.js';
import { pool } from '../../../infrastructure/database/postgres.js';

import type { CreatePendingSignupData, PendingSignup } from '../types/signup.js';

// ============================================================
// Repository contract
// ============================================================

export interface PendingSignupRepository {
  create(data: CreatePendingSignupData): Promise<PendingSignup>;

  /**
   * Returns the pending signup without exposing the provider
   * session token.
   *
   * The session token is sensitive provider credential material
   * and must only be loaded by getOtpProviderSession().
   */
  findById(id: string): Promise<PendingSignup | null>;

  /**
   * Returns the pending signup without exposing the provider
   * session token.
   */
  findByContact(contactType: string, contactValue: string): Promise<PendingSignup | null>;

  /**
   * Loads the provider session credential only for operations
   * that actually need to communicate with the OTP provider.
   */
  getOtpProviderSession(id: string): Promise<{
    provider: string;
    sessionId: string;
    sessionToken: string;
    expiresAt: Date;
    verifiedAt: Date | null;
  } | null>;

  /**
   * Atomically claims the OTP resend cooldown slot.
   *
   * This prevents concurrent resend requests from both passing
   * the cooldown check.
   */
  claimOtpResend(
    id: string,
    cooldownSeconds: number,
  ): Promise<{
    provider: string;
    sessionId: string;
    sessionToken: string;
    expiresAt: Date;
  } | null>;

  /**
   * Updates the provider-reported expiry after a successful
   * provider resend.
   */
  updateOtpProviderExpiry(id: string, expiresAt: Date): Promise<boolean>;

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
            email,
            contact_type,
            contact_value,
            password_hash,
            role,
            otp_hash,
            otp_expires_at,
            otp_attempts,
            otp_verified_at,
            last_otp_sent_at,
            otp_provider,
            otp_provider_session_id,
            otp_provider_session_token,
            otp_provider_expires_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            NULL,
            NULL,
            0,
            NULL,
            NOW(),
            $8,
            $9,
            $10,
            $11
          )
          RETURNING
            id,
            first_name AS "firstName",
            last_name AS "lastName",
            email,
            contact_type AS "contactType",
            contact_value AS "contactValue",
            password_hash AS "passwordHash",
            role,
            otp_hash AS "otpHash",
            otp_expires_at AS "otpExpiresAt",
            otp_attempts AS "otpAttempts",
            otp_verified_at AS "otpVerifiedAt",
            last_otp_sent_at AS "lastOtpSentAt",
            otp_provider AS "otpProvider",
            otp_provider_session_id AS "otpProviderSessionId",
            otp_provider_session_token AS "otpProviderSessionToken",
            otp_provider_expires_at AS "otpProviderExpiresAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `,
        [
          data.firstName,
          data.lastName,
          data.email,
          data.contactType,
          data.contactValue,
          data.passwordHash,
          data.role,
          data.otpProvider,
          data.otpProviderSessionId,
          data.otpProviderSessionToken,
          data.otpProviderExpiresAt,
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
          email,
          contact_type AS "contactType",
          contact_value AS "contactValue",
          password_hash AS "passwordHash",
          role,
          otp_hash AS "otpHash",
          otp_expires_at AS "otpExpiresAt",
          otp_attempts AS "otpAttempts",
          otp_verified_at AS "otpVerifiedAt",
          last_otp_sent_at AS "lastOtpSentAt",
          otp_provider AS "otpProvider",
          otp_provider_session_id AS "otpProviderSessionId",
          otp_provider_expires_at AS "otpProviderExpiresAt",
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
          email,
          contact_type AS "contactType",
          contact_value AS "contactValue",
          password_hash AS "passwordHash",
          role,
          otp_hash AS "otpHash",
          otp_expires_at AS "otpExpiresAt",
          otp_attempts AS "otpAttempts",
          otp_verified_at AS "otpVerifiedAt",
          last_otp_sent_at AS "lastOtpSentAt",
          otp_provider AS "otpProvider",
          otp_provider_session_id AS "otpProviderSessionId",
          otp_provider_expires_at AS "otpProviderExpiresAt",
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
  // Get OTP provider session
  // ----------------------------------------------------------

  async getOtpProviderSession(id: string): Promise<{
    provider: string;
    sessionId: string;
    sessionToken: string;
    expiresAt: Date;
    verifiedAt: Date | null;
  } | null> {
    const result = await pool.query<{
      provider: string;
      sessionId: string;
      sessionToken: string;
      expiresAt: Date;
      verifiedAt: Date | null;
    }>(
      `
        SELECT
          otp_provider AS "provider",
          otp_provider_session_id AS "sessionId",
          otp_provider_session_token AS "sessionToken",
          otp_provider_expires_at AS "expiresAt",
          otp_verified_at AS "verifiedAt"
        FROM pending_signups
        WHERE id = $1
          AND otp_provider IS NOT NULL
          AND otp_provider_session_id IS NOT NULL
          AND otp_provider_session_token IS NOT NULL
          AND otp_provider_expires_at IS NOT NULL
        LIMIT 1
      `,
      [id],
    );

    return result.rows[0] ?? null;
  }

  // ----------------------------------------------------------
  // Atomically claim OTP resend
  // ----------------------------------------------------------

  async claimOtpResend(
    id: string,
    cooldownSeconds: number,
  ): Promise<{
    provider: string;
    sessionId: string;
    sessionToken: string;
    expiresAt: Date;
  } | null> {
    const result = await pool.query<{
      provider: string;
      sessionId: string;
      sessionToken: string;
      expiresAt: Date;
    }>(
      `
        UPDATE pending_signups
        SET
          last_otp_sent_at = NOW()
        WHERE id = $1
          AND otp_verified_at IS NULL
          AND otp_provider IS NOT NULL
          AND otp_provider_session_id IS NOT NULL
          AND otp_provider_session_token IS NOT NULL
          AND otp_provider_expires_at IS NOT NULL
          AND last_otp_sent_at <=
              NOW() -
              ($2::integer * INTERVAL '1 second')
        RETURNING
          otp_provider AS "provider",
          otp_provider_session_id AS "sessionId",
          otp_provider_session_token AS "sessionToken",
          otp_provider_expires_at AS "expiresAt"
      `,
      [id, cooldownSeconds],
    );

    return result.rows[0] ?? null;
  }

  // ----------------------------------------------------------
  // Update provider expiry
  // ----------------------------------------------------------

  async updateOtpProviderExpiry(id: string, expiresAt: Date): Promise<boolean> {
    const result = await pool.query(
      `
        UPDATE pending_signups
        SET
          otp_provider_expires_at = $2
        WHERE id = $1
          AND otp_verified_at IS NULL
          AND otp_provider IS NOT NULL
          AND otp_provider_session_id IS NOT NULL
          AND otp_provider_session_token IS NOT NULL
      `,
      [id, expiresAt],
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
