import { pool } from '../../../infrastructure/database/postgres.js';

export interface CreatePasswordResetChallengeData {
  userId: string;
  email: string;
  otpProvider: string;
  providerSessionId: string;
  encryptedProviderSessionToken: string;
  providerExpiresAt: Date;
  expiresAt: Date;
  lastOtpSentAt: Date;
}

export interface PasswordResetChallenge {
  id: string;
  userId: string;
  email: string;
  otpProvider: string;
  providerSessionId: string;
  encryptedProviderSessionToken: string;
  providerExpiresAt: Date;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface PasswordResetRepository {
  create(data: CreatePasswordResetChallengeData): Promise<{ id: string }>;

  findActiveById(id: string): Promise<PasswordResetChallenge | null>;

  consume(id: string): Promise<boolean>;
}

export class PostgresPasswordResetRepository
  implements PasswordResetRepository
{
  async create(
    data: CreatePasswordResetChallengeData,
  ): Promise<{ id: string }> {
    // Remove expired active challenges for this user first.
    await pool.query(
      `
        DELETE FROM password_reset_challenges
        WHERE user_id = $1
          AND consumed_at IS NULL
          AND verified_at IS NULL
          AND expires_at <= NOW()
      `,
      [data.userId],
    );

    const result = await pool.query<{ id: string }>(
      `
        INSERT INTO password_reset_challenges (
          user_id,
          email,
          otp_provider,
          provider_session_id,
          encrypted_provider_session_token,
          provider_expires_at,
          expires_at,
          last_otp_sent_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        data.userId,
        data.email,
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
      throw new Error('Failed to create password reset challenge');
    }

    return { id: row.id };
  }

  async findActiveById(
    id: string,
  ): Promise<PasswordResetChallenge | null> {
    const result = await pool.query<PasswordResetChallenge>(
      `
        SELECT
          id,
          user_id AS "userId",
          email,
          otp_provider AS "otpProvider",
          provider_session_id AS "providerSessionId",
          encrypted_provider_session_token AS
            "encryptedProviderSessionToken",
          provider_expires_at AS "providerExpiresAt",
          expires_at AS "expiresAt",
          verified_at AS "verifiedAt",
          consumed_at AS "consumedAt"
        FROM password_reset_challenges
        WHERE id = $1
          AND consumed_at IS NULL
          AND verified_at IS NULL
          AND expires_at > NOW()
          AND provider_expires_at > NOW()
        LIMIT 1
      `,
      [id],
    );

    return result.rows[0] ?? null;
  }

  async consume(id: string): Promise<boolean> {
    const result = await pool.query(
      `
        UPDATE password_reset_challenges
        SET
          verified_at = NOW(),
          consumed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
          AND consumed_at IS NULL
          AND verified_at IS NULL
          AND expires_at > NOW()
          AND provider_expires_at > NOW()
      `,
      [id],
    );

    return result.rowCount === 1;
  }
}