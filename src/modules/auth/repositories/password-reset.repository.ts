import type { Pool } from 'pg';

export interface PasswordResetUser {
  id: string;
  email: string;
}

export interface CreatePasswordResetChallengeData {
  userId: string;
  email: string;
  sessionTokenHash: string;
  providerSessionId: string;
  providerSessionTokenEncrypted: string;
  expiresAt: Date;
  lastSentAt: Date;
}

export interface PasswordResetChallenge {
  id: string;
  userId: string;
  email: string;
  sessionTokenHash: string;
  providerSessionId: string;
  providerSessionTokenEncrypted: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  lastSentAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface PasswordResetRepository {
  findActiveUserByEmail(email: string): Promise<PasswordResetUser | null>;

  create(data: CreatePasswordResetChallengeData): Promise<{ id: string }>;

  findBySessionTokenHash(sessionTokenHash: string): Promise<PasswordResetChallenge | null>;

  markVerified(sessionTokenHash: string): Promise<boolean>;

  resend(
    sessionTokenHash: string,
    providerSessionId: string,
    providerSessionTokenEncrypted: string,
    expiresAt: Date,
    lastSentAt: Date,
  ): Promise<boolean>;

  consume(sessionTokenHash: string): Promise<boolean>;
}

export class PostgresPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly pool: Pool) {}

  // ============================================================
  // Find user by email
  // ============================================================

  async findActiveUserByEmail(email: string): Promise<PasswordResetUser | null> {
    const result = await this.pool.query<PasswordResetUser>(
      `
        SELECT
          id,
          email
        FROM users
        WHERE email = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [email],
    );

    return result.rows[0] ?? null;
  }

  // ============================================================
  // Create / replace active password-reset challenge
  // ============================================================
  //
  // The database has a partial unique index:
  //
  //   UNIQUE (user_id) WHERE consumed_at IS NULL
  //
  // Therefore a user can have only one active reset challenge.
  //
  // ON CONFLICT replaces the existing active challenge instead
  // of throwing a unique-constraint error when the user requests
  // another password reset.
  // ============================================================

  async create(data: CreatePasswordResetChallengeData): Promise<{ id: string }> {
    const result = await this.pool.query<{ id: string }>(
      `
        INSERT INTO password_reset_challenges (
          user_id,
          email,
          session_token_hash,
          provider_session_id,
          provider_session_token_encrypted,
          expires_at,
          last_sent_at,
          attempts,
          verified_at,
          consumed_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          0,
          NULL,
          NULL,
          NOW()
        )
        ON CONFLICT (user_id)
        WHERE consumed_at IS NULL
        DO UPDATE SET
          email = EXCLUDED.email,
          session_token_hash = EXCLUDED.session_token_hash,
          provider_session_id = EXCLUDED.provider_session_id,
          provider_session_token_encrypted =
            EXCLUDED.provider_session_token_encrypted,
          expires_at = EXCLUDED.expires_at,
          last_sent_at = EXCLUDED.last_sent_at,
          attempts = 0,
          verified_at = NULL,
          consumed_at = NULL,
          updated_at = NOW()
        RETURNING id
      `,
      [
        data.userId,
        data.email,
        data.sessionTokenHash,
        data.providerSessionId,
        data.providerSessionTokenEncrypted,
        data.expiresAt,
        data.lastSentAt,
      ],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error('Failed to create password reset challenge');
    }

    return {
      id: row.id,
    };
  }

  // ============================================================
  // Find challenge by application reset-session token hash
  // ============================================================

  async findBySessionTokenHash(sessionTokenHash: string): Promise<PasswordResetChallenge | null> {
    const result = await this.pool.query<PasswordResetChallenge>(
      `
          SELECT
            id,
            user_id AS "userId",
            email,
            TRIM(session_token_hash) AS "sessionTokenHash",
            provider_session_id AS "providerSessionId",
            provider_session_token_encrypted
              AS "providerSessionTokenEncrypted",
            attempts,
            max_attempts AS "maxAttempts",
            expires_at AS "expiresAt",
            last_sent_at AS "lastSentAt",
            verified_at AS "verifiedAt",
            consumed_at AS "consumedAt"
          FROM password_reset_challenges
          WHERE session_token_hash = $1
          LIMIT 1
        `,
      [sessionTokenHash],
    );

    return result.rows[0] ?? null;
  }

  // ============================================================
  // Mark OTP verification successful
  // ============================================================

  async markVerified(sessionTokenHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE password_reset_challenges
        SET
          verified_at = NOW(),
          updated_at = NOW()
        WHERE session_token_hash = $1
          AND consumed_at IS NULL
          AND verified_at IS NULL
          AND expires_at > NOW()
      `,
      [sessionTokenHash],
    );

    return result.rowCount === 1;
  }

  // ============================================================
  // Resend / replace provider session
  // ============================================================

  async resend(
    sessionTokenHash: string,
    providerSessionId: string,
    providerSessionTokenEncrypted: string,
    expiresAt: Date,
    lastSentAt: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE password_reset_challenges
        SET
          provider_session_id = $2,
          provider_session_token_encrypted = $3,
          attempts = 0,
          expires_at = $4,
          last_sent_at = $5,
          verified_at = NULL,
          consumed_at = NULL,
          updated_at = NOW()
        WHERE session_token_hash = $1
          AND consumed_at IS NULL
      `,
      [sessionTokenHash, providerSessionId, providerSessionTokenEncrypted, expiresAt, lastSentAt],
    );

    return result.rowCount === 1;
  }

  // ============================================================
  // Consume verified reset session
  // ============================================================

  async consume(sessionTokenHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE password_reset_challenges
        SET
          consumed_at = NOW(),
          updated_at = NOW()
        WHERE session_token_hash = $1
          AND consumed_at IS NULL
          AND verified_at IS NOT NULL
      `,
      [sessionTokenHash],
    );

    return result.rowCount === 1;
  }
}
