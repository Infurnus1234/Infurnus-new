import { Pool } from 'pg';

import { AppError } from '../../../common/errors/app-error.js';
import { withTransaction } from '../../../infrastructure/database/postgres.js';

import type {
  ConsumeLoginChallengeResult,
  CreateLoginChallengeData,
  LoginChallengeProviderSession,
  LoginChallengeResendClaim,
} from '../types/login-challenge.js';

export interface LoginChallengeRepository {
  create(data: CreateLoginChallengeData): Promise<{ id: string }>;

  getProviderSession(challengeId: string): Promise<LoginChallengeProviderSession | null>;

  claimResend(
    challengeId: string,
    cooldownSeconds: number,
  ): Promise<LoginChallengeResendClaim | null>;

  updateProviderExpiry(challengeId: string, providerExpiresAt: Date): Promise<boolean>;

  consume(challengeId: string): Promise<ConsumeLoginChallengeResult>;
}

export class PostgresLoginChallengeRepository implements LoginChallengeRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: CreateLoginChallengeData): Promise<{ id: string }> {
    return withTransaction(async (client) => {
      /*
       * An expired, still-unconsumed challenge must not block
       * creation of a fresh challenge for the same user.
       *
       * Expired challenges are deleted rather than marked as
       * consumed because consumption represents a successfully
       * verified challenge.
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
              provider_session_id,
              encrypted_provider_session_token,
              provider_expires_at,
              expires_at,
              last_otp_sent_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
          `,
          [
            data.userId,
            data.otpProvider,
            data.providerSessionId,
            data.encryptedProviderSessionToken,
            data.providerExpiresAt,
            data.expiresAt,
            data.lastOtpSentAt,
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

  async getProviderSession(challengeId: string): Promise<LoginChallengeProviderSession | null> {
    const result = await this.pool.query<LoginChallengeProviderSession>(
      `
          SELECT
            id,
            user_id AS "userId",
            otp_provider AS "otpProvider",
            provider_session_id AS "providerSessionId",
            encrypted_provider_session_token AS
              "encryptedProviderSessionToken",
            provider_expires_at AS "providerExpiresAt",
            expires_at AS "expiresAt",
            verified_at AS "verifiedAt",
            consumed_at AS "consumedAt"
          FROM login_challenges
          WHERE id = $1
          LIMIT 1
        `,
      [challengeId],
    );

    return result.rows[0] ?? null;
  }

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
            AND last_otp_sent_at <=
              NOW() - ($2 * INTERVAL '1 second')
          RETURNING
            id,
            user_id AS "userId",
            otp_provider AS "otpProvider",
            provider_session_id AS "providerSessionId",
            encrypted_provider_session_token AS
              "encryptedProviderSessionToken",
            provider_expires_at AS "providerExpiresAt",
            expires_at AS "expiresAt",
            last_otp_sent_at AS "lastOtpSentAt"
        `,
      [challengeId, cooldownSeconds],
    );

    return result.rows[0] ?? null;
  }

  async updateProviderExpiry(challengeId: string, providerExpiresAt: Date): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE login_challenges
        SET
          provider_expires_at = $2,
          updated_at = NOW()
        WHERE id = $1
          AND consumed_at IS NULL
          AND verified_at IS NULL
      `,
      [challengeId, providerExpiresAt],
    );

    return result.rowCount === 1;
  }

  async consume(challengeId: string): Promise<ConsumeLoginChallengeResult> {
    return withTransaction(async (client) => {
      /*
       * Lock the challenge row so concurrent verification requests
       * cannot both consume the same challenge.
       */
      const challengeResult = await client.query<{
        userId: string;
        verifiedAt: Date | null;
        consumedAt: Date | null;
        expiresAt: Date;
      }>(
        `
          SELECT
            user_id AS "userId",
            verified_at AS "verifiedAt",
            consumed_at AS "consumedAt",
            expires_at AS "expiresAt"
          FROM login_challenges
          WHERE id = $1
          FOR UPDATE
        `,
        [challengeId],
      );

      const challenge = challengeResult.rows[0];

      if (!challenge) {
        return {
          status: 'not_found',
        };
      }

      if (challenge.consumedAt || challenge.verifiedAt) {
        return {
          status: 'already_consumed',
        };
      }

      if (challenge.expiresAt.getTime() <= Date.now()) {
        return {
          status: 'expired',
        };
      }

      /*
       * Atomically mark the challenge as verified and consumed.
       *
       * Only an active challenge belonging to a non-deleted user
       * can transition into the consumed state.
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
            AND lc.expires_at > NOW()
          RETURNING
            lc.user_id AS "userId",
            u.role
        `,
        [challengeId],
      );

      const consumed = consumeResult.rows[0];

      if (!consumed) {
        return {
          status: 'already_consumed',
        };
      }

      return {
        status: 'consumed',
        userId: consumed.userId,
        role: consumed.role,
      };
    });
  }
}
