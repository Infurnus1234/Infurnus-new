import { AppError } from '../../../common/errors/app-error.js';
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
    }
  | { status: 'expired' };

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
   * - create driver profile when required
   * - create partner profile when required
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
    try {
      return await withTransaction(async (client) => {
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
          onboardingLicencePending: boolean;
          licenseNumber: string | null;
          licenseExpiry: Date | null;
          businessName: string | null;
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
            licence_onboarding_pending AS "onboardingLicencePending",
            license_number AS "licenseNumber",
            license_expiry AS "licenseExpiry",
            business_name AS "businessName",
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

        const verified = await client.query(
          `
          UPDATE pending_signups
          SET otp_verified_at = NOW()
          WHERE id = $1
            AND otp_verified_at IS NULL
            AND otp_provider_expires_at > clock_timestamp()
          RETURNING id
        `,
          [signupId],
        );
        // Recheck after provider I/O and after acquiring the row lock.
        if (verified.rowCount !== 1) return { status: 'expired' };

        // ======================================================
        // Determine verified contact.
        //
        // Phone signup:
        // - phone is verified
        // - email remains unverified
        //
        // Email signup:
        // - email is verified
        // - phone remains NULL/unverified
        // ======================================================

        const isPhoneSignup = pendingSignup.contactType === 'phone';

        const phone = isPhoneSignup ? pendingSignup.contactValue : null;

        const email = pendingSignup.email;

        const emailVerified = !isPhoneSignup;
        const phoneVerified = isPhoneSignup;

        // ======================================================
        // Role-specific signup data
        // ======================================================

        const isDriver =
          pendingSignup.role === 'driver' || pendingSignup.role === 'driver_fleet_owner';

        const isFleetOwner =
          pendingSignup.role === 'fleet_owner' || pendingSignup.role === 'driver_fleet_owner';

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
        // Create driver profile
        //
        // Required for:
        // - driver
        // - driver_fleet_owner
        //
        // Verification remains PENDING.
        // Admin/Super Admin approval happens later.
        // ======================================================

        // Deferred licence enrolment creates no profile or operational eligibility.
        // The existing protected profile/document APIs complete it after sign-in.
        if (isDriver && !pendingSignup.onboardingLicencePending) {
          if (!pendingSignup.licenseNumber || !pendingSignup.licenseExpiry) {
            throw new Error('Driver signup is missing required license information');
          }

          await client.query(
            `
            INSERT INTO driver_profiles (
              user_id,
              license_number,
              license_expiry
            )
            VALUES ($1, $2, $3)
          `,
            [user.id, pendingSignup.licenseNumber, pendingSignup.licenseExpiry],
          );
        }

        // ======================================================
        // Create partner profile
        //
        // Required for:
        // - fleet_owner
        // - driver_fleet_owner
        //
        // Partner approval remains PENDING.
        // Admin/Super Admin approval happens later.
        //
        // Do NOT create partner_drivers here.
        // That relationship is created after a Driver Application
        // is approved.
        // ======================================================

        if (isFleetOwner) {
          if (!pendingSignup.businessName) {
            throw new Error('Fleet owner signup is missing required business name');
          }

          await client.query(
            `
            INSERT INTO partners (
              user_id,
              business_name
            )
            VALUES ($1, $2)
          `,
            [user.id, pendingSignup.businessName],
          );
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
        // the user and required domain profiles have been created.
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

        if (['driver', 'driver_fleet_owner', 'fleet_owner'].includes(user.role))
          await client.query(
            'INSERT INTO provider_onboarding(user_id,role_flow_active) VALUES($1,TRUE) ON CONFLICT DO NOTHING',
            [user.id],
          );
        return {
          status: 'completed',
          user,
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new AppError('ACCOUNT_ALREADY_EXISTS', 'An account already exists in this role', 409);
      throw error;
    }
  }
}
