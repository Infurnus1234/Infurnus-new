import { withTransaction } from '../../../infrastructure/database/postgres.js';

// ============================================================
// Completed user
// ============================================================

export interface CompletedSignupUser {
  id: string;
  role: string;
  status: string;
}

// ============================================================
// Signup completion result
// ============================================================

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
    };

// ============================================================
// Repository contract
// ============================================================

export interface SignupCompletionRepository {
  /**
   * Atomically completes a signup that has already been
   * verified by the external OTP provider.
   *
   * This method does NOT verify the OTP.
   *
   * Responsibilities:
   * - lock pending signup
   * - prevent duplicate completion
   * - mark provider verification locally
   * - create users row
   * - create password credentials
   * - delete pending signup
   */
  completeVerifiedSignup(signupId: string): Promise<SignupCompletionResult>;
}

// ============================================================
// PostgreSQL implementation
// ============================================================

export class PostgresSignupCompletionRepository implements SignupCompletionRepository {
  async completeVerifiedSignup(signupId: string): Promise<SignupCompletionResult> {
    return withTransaction(async (client) => {
      // ======================================================
      // Lock pending signup
      //
      // This prevents two concurrent completion requests from
      // creating two users from the same pending signup.
      // ======================================================

      const pendingResult = await client.query<{
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
        contactType: 'email' | 'phone';
        contactValue: string;
        passwordHash: string;
        role: string;
        otpVerifiedAt: Date | null;
      }>(
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
            otp_verified_at AS "otpVerifiedAt"
          FROM pending_signups
          WHERE id = $1
          FOR UPDATE
        `,
        [signupId],
      );

      const pendingSignup = pendingResult.rows[0];

      // ======================================================
      // Pending signup no longer exists.
      //
      // This can happen if another successful transaction
      // already completed and deleted it.
      // ======================================================

      if (!pendingSignup) {
        return {
          status: 'not_found',
        };
      }

      // ======================================================
      // Prevent duplicate verification/completion.
      // ======================================================

      if (pendingSignup.otpVerifiedAt) {
        return {
          status: 'already_verified',
        };
      }

      // ======================================================
      // Mark provider verification locally.
      //
      // The actual OTP verification has already happened
      // through the OTP provider before this method is called.
      // ======================================================

      await client.query(
        `
          UPDATE pending_signups
          SET otp_verified_at = NOW()
          WHERE id = $1
            AND otp_verified_at IS NULL
        `,
        [signupId],
      );

      // ======================================================
      // Determine verified contact.
      //
      // Rules:
      //
      // 1. Phone signup:
      //    - contactValue = phone
      //    - phone is verified
      //    - email remains unverified
      //
      // 2. Email signup:
      //    - contactValue = email
      //    - email is verified
      //    - phone remains NULL/unverified
      //
      // 3. Both email + phone supplied:
      //    - contactType is phone because phone is the
      //      selected OTP channel
      //    - phone is verified
      //    - email remains unverified
      // ======================================================

      const isPhoneSignup = pendingSignup.contactType === 'phone';

      const phone = isPhoneSignup ? pendingSignup.contactValue : null;

      const email = pendingSignup.email;

      const emailVerified = !isPhoneSignup;
      const phoneVerified = isPhoneSignup;

      // ======================================================
      // Create actual user.
      // ======================================================

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
            $3,
            $4,
            $5,
            $6,
            $7,
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
          email,
          phone,
          emailVerified,
          phoneVerified,
          pendingSignup.role,
        ],
      );

      const user = userResult.rows[0];

      if (!user) {
        throw new Error('Failed to create user during signup completion');
      }

      // ======================================================
      // Create password credentials.
      //
      // passwordHash is already an Argon2 hash.
      // ======================================================

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

      // ======================================================
      // Delete pending signup.
      //
      // The temporary signup state is no longer needed after
      // the user and credentials have been created.
      // ======================================================

      await client.query(
        `
          DELETE FROM pending_signups
          WHERE id = $1
        `,
        [signupId],
      );

      // ======================================================
      // Transaction commits automatically when the callback
      // completes successfully.
      // ======================================================

      return {
        status: 'completed',
        user,
      };
    });
  }
}
