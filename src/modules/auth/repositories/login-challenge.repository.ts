import type { Pool, PoolClient } from 'pg';

import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';

import type {
  ConsumeLoginChallengeResult,
  CreateLoginChallengeData,
  LoginChallengeProviderSession,
  LoginChallengeResendClaim,
} from '../types/login-challenge.js';

// ============================================================
// Repository Contract
// ============================================================

export interface LoginChallengeRepository {
  claimVerificationAttempt(id: string, maxAttempts: number): Promise<boolean>;
  create(data: CreateLoginChallengeData): Promise<{ id: string }>;

  getProviderSession(challengeId: string): Promise<LoginChallengeProviderSession | null>;

  claimResend(
    challengeId: string,
    cooldownSeconds: number,
  ): Promise<LoginChallengeResendClaim | null>;

  updateProviderExpiry(challengeId: string, providerExpiresAt: Date): Promise<boolean>;

  consume(challengeId: string): Promise<ConsumeLoginChallengeResult>;
}

// ============================================================
// PostgreSQL Implementation
// ============================================================

export class PostgresLoginChallengeRepository implements LoginChallengeRepository {
  async claimVerificationAttempt(id: string, maxAttempts: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE login_challenges SET verification_attempts=verification_attempts+1
       WHERE id=$1 AND consumed_at IS NULL AND expires_at>NOW()
       AND verification_attempts<$2 RETURNING id`,
      [id, maxAttempts],
    );
    return result.rowCount === 1;
  }

  constructor(private readonly pool: Pool) {}

  // ==========================================================
  // Transaction Helper
  // ==========================================================

  private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const result = await operation(client);

      await client.query('COMMIT');

      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original database/application error.
      }

      throw error;
    } finally {
      client.release();
    }
  }

  // ==========================================================
  // Create Login Challenge
  // ==========================================================

  async create(data: CreateLoginChallengeData): Promise<{ id: string }> {
    return this.withTransaction(async (client) => {
      /*
       * Remove expired active challenges before creating
       * a new challenge.
       */
      await client.query(
        `
          DELETE FROM login_challenges
          WHERE user_id = $1
            AND consumed_at IS NULL
            AND verified_at IS NULL
            AND expires_at <= NOW()
        `,
        [data.userId],
      );

      try {
        const result = await client.query<{ id: string }>(
          `
            INSERT INTO login_challenges (
              user_id,
              otp_provider,
              otp_channel,
              provider_session_id,
              encrypted_provider_session_token,
              provider_expires_at,
              expires_at,
              last_otp_sent_at,
              provisioned_contact_value
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
          `,
          [
            data.userId,
            data.otpProvider,
            data.otpChannel,
            data.providerSessionId,
            data.encryptedProviderSessionToken,
            data.providerExpiresAt,
            data.expiresAt,
            data.lastOtpSentAt,
            data.provisionedContactValue ?? null,
          ],
        );

        const row = result.rows[0];

        if (!row) {
          throw new AppError(
            'LOGIN_CHALLENGE_CREATE_FAILED',
            'Failed to create login challenge',
            500,
          );
        }

        return {
          id: row.id,
        };
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error as { code?: string }).code === '23505'
        ) {
          throw new AppError(
            'LOGIN_CHALLENGE_ALREADY_ACTIVE',
            'A login challenge is already active',
            409,
          );
        }

        throw error;
      }
    });
  }

  // ==========================================================
  // Get Provider Session
  // ==========================================================

  async getProviderSession(challengeId: string): Promise<LoginChallengeProviderSession | null> {
    const result = await this.pool.query<LoginChallengeProviderSession>(
      `
          SELECT
            id,
            user_id AS "userId",
            otp_provider AS "otpProvider",
            otp_channel AS "otpChannel",
            provider_session_id AS "providerSessionId",
            encrypted_provider_session_token AS
              "encryptedProviderSessionToken",
            provider_expires_at AS "providerExpiresAt",
            expires_at AS "expiresAt",
            verified_at AS "verifiedAt",
              (expires_at<=NOW() OR provider_expires_at<=NOW()) AS "databaseExpired",
            consumed_at AS "consumedAt"
          FROM login_challenges
          WHERE id = $1
            AND EXISTS (
              SELECT 1 FROM users u WHERE u.id = login_challenges.user_id
                AND u.role NOT IN ('admin', 'super_admin')
                AND u.status = 'active' AND u.deleted_at IS NULL
            )
          LIMIT 1
        `,
      [challengeId],
    );

    return result.rows[0] ?? null;
  }

  // ==========================================================
  // Atomically Claim Resend
  // ==========================================================

  async claimResend(
    challengeId: string,
    cooldownSeconds: number,
  ): Promise<LoginChallengeResendClaim | null> {
    const result = await this.pool.query<LoginChallengeResendClaim>(
      `
          UPDATE login_challenges
          SET
            last_otp_sent_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
            AND consumed_at IS NULL
            AND verified_at IS NULL
            AND expires_at > NOW()
            AND provider_expires_at > NOW()
            AND verification_attempts < $3
            AND last_otp_sent_at <=
              NOW() - ($2 * INTERVAL '1 second')
          RETURNING
            id,
            user_id AS "userId",
            otp_provider AS "otpProvider",
            otp_channel AS "otpChannel",
            provider_session_id AS "providerSessionId",
            encrypted_provider_session_token AS
              "encryptedProviderSessionToken",
            provider_expires_at AS "providerExpiresAt",
            expires_at AS "expiresAt",
            last_otp_sent_at AS "lastOtpSentAt"
        `,
      [challengeId, cooldownSeconds, env.AUTH_OTP_MAX_ATTEMPTS],
    );

    return result.rows[0] ?? null;
  }

  // ==========================================================
  // Update Provider Expiry
  // ==========================================================

  async updateProviderExpiry(challengeId: string, providerExpiresAt: Date): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE login_challenges
        SET
          provider_expires_at = $2,
          expires_at = $2,
          updated_at = NOW()
        WHERE id = $1
          AND consumed_at IS NULL
          AND verified_at IS NULL
          AND expires_at > NOW()
      `,
      [challengeId, providerExpiresAt],
    );

    return result.rowCount === 1;
  }

  // ==========================================================
  // Consume Login Challenge
  // ==========================================================

  async consume(challengeId: string): Promise<ConsumeLoginChallengeResult> {
    return this.withTransaction(async (client) => {
      /*
       * Lock the challenge row so concurrent verification
       * requests cannot both consume the same challenge.
       */
      const challengeResult = await client.query<{
        userId: string;
        verifiedAt: Date | null;
        consumedAt: Date | null;
        expired: boolean;
        provisionedContactValue: string | null;
        otpChannel: string;
      }>(
        `
          SELECT
            user_id AS "userId",
            provisioned_contact_value AS "provisionedContactValue",
            otp_channel AS "otpChannel",
            verified_at AS "verifiedAt",
            consumed_at AS "consumedAt",
            (expires_at <= clock_timestamp() OR provider_expires_at <= clock_timestamp()) AS expired
          FROM login_challenges
          WHERE id = $1
          FOR UPDATE
        `,
        [challengeId],
      );

      const challenge = challengeResult.rows[0];

      // ------------------------------------------------------
      // Challenge not found
      // ------------------------------------------------------

      if (!challenge) {
        return {
          status: 'not_found',
        };
      }

      // ------------------------------------------------------
      // Challenge expired
      // ------------------------------------------------------

      /*
       * Expiry takes precedence over consumed / verified state.
       *
       * If either the local challenge or the provider session
       * has expired, the challenge cannot be used anymore.
       */
      if (challenge.expired) {
        return {
          status: 'expired',
        };
      }

      // ------------------------------------------------------
      // Challenge already consumed / verified
      // ------------------------------------------------------

      if (challenge.consumedAt || challenge.verifiedAt) {
        return {
          status: 'already_consumed',
        };
      }

      // ------------------------------------------------------
      // Atomically consume challenge
      // ------------------------------------------------------

      /*
       * Mark the challenge as verified and consumed.
       *
       * The user must:
       * - exist
       * - not be soft-deleted
       * - still have an unused challenge
       * - have an unexpired local challenge
       * - have an unexpired provider session
       */
      const consumeResult = await client.query<{
        userId: string;
        role: string;
      }>(
        `
          UPDATE login_challenges AS lc
          SET
            verified_at = NOW(),
            consumed_at = NOW(),
            updated_at = NOW()
          FROM users AS u
          WHERE lc.id = $1
            AND u.id = lc.user_id
            AND u.deleted_at IS NULL
            AND lc.consumed_at IS NULL
            AND lc.verified_at IS NULL
            AND lc.expires_at > clock_timestamp()
            AND lc.provider_expires_at > clock_timestamp()
          RETURNING
            lc.user_id AS "userId",
            u.role
        `,
        [challengeId],
      );

      const consumed = consumeResult.rows[0];

      // ------------------------------------------------------
      // Challenge could not be consumed
      // ------------------------------------------------------

      if (!consumed) {
        /*
         * The challenge was valid when initially checked, but
         * the UPDATE could not transition it to consumed.
         *
         * Check whether the associated user still exists.
         */
        const userResult = await client.query<{ id: string }>(
          `
            SELECT id
            FROM users
            WHERE id = $1
              AND deleted_at IS NULL
            LIMIT 1
          `,
          [challenge.userId],
        );

        if (userResult.rows.length === 0) {
          return {
            status: 'not_found',
          };
        }

        return {
          status: 'already_consumed',
        };
      }

      if (challenge.provisionedContactValue) {
        // Verification and challenge consumption commit together. Recheck the
        // exact provisioned contact and fleet authority after provider verification.
        const verified = await client.query(
          `UPDATE users u SET
             email_verified=CASE WHEN $2='email' THEN TRUE ELSE u.email_verified END,
             phone_verified=CASE WHEN $2='sms' THEN TRUE ELSE u.phone_verified END,
             updated_at=NOW()
           WHERE u.id=$1 AND u.role='driver' AND u.status='active' AND u.deleted_at IS NULL
             AND EXISTS(SELECT 1 FROM fleet_managed_driver_accounts m
               JOIN partners p ON p.id=m.partner_id JOIN users owner ON owner.id=p.user_id
               WHERE m.driver_user_id=u.id AND m.status='ACTIVE'
                 AND owner.status='active' AND owner.deleted_at IS NULL
                 AND owner.role IN ('fleet_owner','driver_fleet_owner') AND (
                   ($2='email' AND m.provisioned_email=$3 AND lower(btrim(u.email))=$3) OR
                   ($2='sms' AND m.provisioned_phone=$3 AND u.phone=$3)))
           RETURNING u.id`,
          [challenge.userId, challenge.otpChannel, challenge.provisionedContactValue],
        );
        if (!verified.rowCount)
          throw new AppError('INVALID_LOGIN_CHALLENGE', 'Login contact is no longer eligible', 400);
        await client.query(
          `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata)
           VALUES($1,'managed_driver_contact_verified','user',$1,jsonb_build_object('channel',$2::text))`,
          [challenge.userId, challenge.otpChannel],
        );
      }

      // ------------------------------------------------------
      // Successfully consumed
      // ------------------------------------------------------

      return {
        status: 'consumed',
        userId: consumed.userId,
        role: consumed.role,
      };
    });
  }
}
