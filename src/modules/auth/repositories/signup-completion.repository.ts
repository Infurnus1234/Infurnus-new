import { withTransaction } from '../../../infrastructure/database/postgres.js';

export interface CompletedSignupUser {
  id: string;
  role: string;
  status: string;
}

export type SignupCompletionResult =
  | {
      status: 'completed';
      user: CompletedSignupUser;
    }
  | {
      status: 'not_found';
    }
  | {
      status: 'already_verified';
    }
  | {
      status: 'expired';
    }
  | {
      status: 'attempts_exceeded';
    }
  | {
      status: 'invalid_otp';
    };

const MAX_OTP_ATTEMPTS = 5;

export interface SignupCompletionRepository {
  verifyAndComplete(signupId: string, otpHash: string): Promise<SignupCompletionResult>;
}

export class PostgresSignupCompletionRepository implements SignupCompletionRepository {
  async verifyAndComplete(signupId: string, otpHash: string): Promise<SignupCompletionResult> {
    return withTransaction(async (client) => {
      // ========================================================
      // Lock the pending signup.
      //
      // This prevents two concurrent OTP verification requests
      // from completing the same signup simultaneously.
      // ========================================================

      const pendingResult = await client.query<{
        id: string;
        firstName: string;
        lastName: string;
        contactType: 'email' | 'phone';
        contactValue: string;
        passwordHash: string;
        role: string;
        otpHash: string;
        otpExpiresAt: Date;
        otpAttempts: number;
        otpVerifiedAt: Date | null;
      }>(
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
            otp_verified_at AS "otpVerifiedAt"
          FROM pending_signups
          WHERE id = $1
          FOR UPDATE
        `,
        [signupId],
      );

      const pendingSignup = pendingResult.rows[0];

      if (!pendingSignup) {
        return {
          status: 'not_found',
        };
      }

      // ========================================================
      // Prevent re-verification.
      // ========================================================

      if (pendingSignup.otpVerifiedAt) {
        return {
          status: 'already_verified',
        };
      }

      // ========================================================
      // Check OTP expiry.
      // ========================================================

      if (pendingSignup.otpExpiresAt.getTime() <= Date.now()) {
        return {
          status: 'expired',
        };
      }

      // ========================================================
      // Check maximum attempts.
      // ========================================================

      if (pendingSignup.otpAttempts >= MAX_OTP_ATTEMPTS) {
        return {
          status: 'attempts_exceeded',
        };
      }

      // ========================================================
      // Compare hashes.
      //
      // Raw OTP is never stored or queried.
      // ========================================================

      if (pendingSignup.otpHash !== otpHash) {
        await client.query(
          `
            UPDATE pending_signups
            SET otp_attempts = otp_attempts + 1
            WHERE id = $1
          `,
          [signupId],
        );

        return {
          status: 'invalid_otp',
        };
      }

      // ========================================================
      // Mark OTP verified.
      // ========================================================

      await client.query(
        `
          UPDATE pending_signups
          SET otp_verified_at = NOW()
          WHERE id = $1
        `,
        [signupId],
      );

      // ========================================================
      // Create the actual user.
      //
      // Email signup:
      //   email = contact_value
      //   phone = NULL
      //
      // Phone signup:
      //   email = NULL
      //   phone = contact_value
      // ========================================================

      const userResult = await client.query<CompletedSignupUser>(
        `
          INSERT INTO users (
            first_name,
            last_name,
            email,
            phone,
            email_verified,
            phone_verified,
            role,
            status
          )
          VALUES (
            $1,
            $2,
            CASE
              WHEN $3 = 'email' THEN $4
              ELSE NULL
            END,
            CASE
              WHEN $3 = 'phone' THEN $4
              ELSE NULL
            END,
            CASE
              WHEN $3 = 'email' THEN TRUE
              ELSE FALSE
            END,
            CASE
              WHEN $3 = 'phone' THEN TRUE
              ELSE FALSE
            END,
            $5,
            'active'
          )
          RETURNING
            id,
            role,
            status
        `,
        [
          pendingSignup.firstName,
          pendingSignup.lastName,
          pendingSignup.contactType,
          pendingSignup.contactValue,
          pendingSignup.role,
        ],
      );

      const user = userResult.rows[0];

      // ========================================================
      // Create password credentials.
      //
      // passwordHash is already an Argon2 hash.
      // ========================================================

      await client.query(
        `
          INSERT INTO user_credentials (
            user_id,
            password_hash
          )
          VALUES ($1, $2)
        `,
        [user.id, pendingSignup.passwordHash],
      );

      // ========================================================
      // Remove pending signup.
      //
      // After successful completion, this temporary record is
      // no longer needed.
      // ========================================================

      await client.query(
        `
          DELETE FROM pending_signups
          WHERE id = $1
        `,
        [signupId],
      );

      // ========================================================
      // Transaction commits automatically when this callback
      // returns successfully.
      // ========================================================

      return {
        status: 'completed',
        user,
      };
    });
  }
}
