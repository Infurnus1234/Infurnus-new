import type { Pool } from 'pg';

import type {
  CreateResendOtpSessionData,
  ResendOtpSession,
  ResendOtpSessionRepository,
  VerifyResendOtpResult,
} from '../types/resend-otp.js';

// ============================================================
// PostgreSQL Implementation
// ============================================================

export class PostgresResendOtpSessionRepository implements ResendOtpSessionRepository {
  constructor(private readonly pool: Pool) {}

  // ==========================================================
  // Create Session
  // ==========================================================

  async create(data: CreateResendOtpSessionData): Promise<{ id: string }> {
    const result = await this.pool.query<{ id: string }>(
      `
        INSERT INTO resend_otp_sessions (
          email,
          session_token_hash,
          otp_hash,
          expires_at,
          last_sent_at
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [data.email, data.sessionTokenHash, data.otpHash, data.expiresAt, data.lastSentAt],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error('Failed to create Resend OTP session');
    }

    return {
      id: row.id,
    };
  }

  // ==========================================================
  // Find Session
  // ==========================================================

  async findBySessionTokenHash(sessionTokenHash: string): Promise<ResendOtpSession | null> {
    const result = await this.pool.query<ResendOtpSession>(
      `
        SELECT
          id,
          email,
          TRIM(session_token_hash) AS "sessionTokenHash",
          TRIM(otp_hash) AS "otpHash",
          attempts,
          max_attempts AS "maxAttempts",
          expires_at AS "expiresAt",
          last_sent_at AS "lastSentAt",
          consumed_at AS "consumedAt"
        FROM resend_otp_sessions
        WHERE session_token_hash = $1
        LIMIT 1
      `,
      [sessionTokenHash],
    );

    return result.rows[0] ?? null;
  }

  // ==========================================================
  // Verify OTP
  // ==========================================================

  async verify(sessionTokenHash: string, otpHash: string): Promise<VerifyResendOtpResult> {
    const result = await this.pool.query<{
      status: VerifyResendOtpResult['status'];
      attemptsRemaining: number | null;
    }>(
      `
        WITH current_session AS (
          SELECT
            id,
            otp_hash,
            attempts,
            max_attempts,
            expires_at,
            consumed_at
          FROM resend_otp_sessions
          WHERE session_token_hash = $1
          FOR UPDATE
        ),
        verified AS (
          UPDATE resend_otp_sessions AS s
          SET
            consumed_at = NOW(),
            updated_at = NOW()
          FROM current_session AS c
          WHERE s.id = c.id
            AND c.consumed_at IS NULL
            AND c.expires_at > NOW()
            AND c.attempts < c.max_attempts
            AND c.otp_hash = $2
          RETURNING
            'verified'::text AS status,
            GREATEST(s.max_attempts - s.attempts, 0) AS "attemptsRemaining"
        ),
        invalid AS (
          UPDATE resend_otp_sessions AS s
          SET
            attempts = s.attempts + 1,
            updated_at = NOW()
          FROM current_session AS c
          WHERE s.id = c.id
            AND c.consumed_at IS NULL
            AND c.expires_at > NOW()
            AND c.attempts < c.max_attempts
            AND c.otp_hash <> $2
          RETURNING
            'invalid'::text AS status,
            GREATEST(s.max_attempts - s.attempts, 0) AS "attemptsRemaining"
        )
        SELECT status, "attemptsRemaining"
        FROM verified

        UNION ALL

        SELECT status, "attemptsRemaining"
        FROM invalid
        WHERE NOT EXISTS (
          SELECT 1 FROM verified
        )

        UNION ALL

        SELECT
          CASE
            WHEN c.consumed_at IS NOT NULL THEN 'already_consumed'
            WHEN c.expires_at <= NOW() THEN 'expired'
            WHEN c.attempts >= c.max_attempts THEN 'attempts_exceeded'
            ELSE 'invalid'
          END AS status,
          CASE
            WHEN c.attempts >= c.max_attempts
              THEN 0
            ELSE GREATEST(c.max_attempts - c.attempts, 0)
          END AS "attemptsRemaining"
        FROM current_session AS c
        WHERE NOT EXISTS (
          SELECT 1 FROM verified
        )
        AND NOT EXISTS (
          SELECT 1 FROM invalid
        )
      `,
      [sessionTokenHash, otpHash],
    );

    const row = result.rows[0];

    if (!row) {
      return {
        status: 'not_found',
      };
    }

    return {
      status: row.status,
      ...(row.attemptsRemaining !== null ? { attemptsRemaining: row.attemptsRemaining } : {}),
    };
  }

  // ==========================================================
  // Resend
  // ==========================================================

  async resend(
    sessionTokenHash: string,
    otpHash: string,
    expiresAt: Date,
    lastSentAt: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE resend_otp_sessions
        SET
          otp_hash = $2,
          attempts = 0,
          expires_at = $3,
          last_sent_at = $4,
          consumed_at = NULL,
          updated_at = NOW()
        WHERE session_token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > NOW()
      `,
      [sessionTokenHash, otpHash, expiresAt, lastSentAt],
    );

    return result.rowCount === 1;
  }

  // ==========================================================
  // Consume Session
  // ==========================================================

  async consume(sessionTokenHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE resend_otp_sessions
        SET
          consumed_at = NOW(),
          updated_at = NOW()
        WHERE session_token_hash = $1
          AND consumed_at IS NULL
      `,
      [sessionTokenHash],
    );

    return result.rowCount === 1;
  }
}
