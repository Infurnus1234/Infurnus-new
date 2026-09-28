// ============================================================
// Signup contact type
// ============================================================

export type SignupContactType = 'email' | 'phone';

// ============================================================
// Public signup roles
//
// Admin and Super Admin are intentionally excluded.
// They are provisioned through the controlled admin flow.
// ============================================================

export type PublicSignupRole = 'customer' | 'driver' | 'fleet_owner' | 'driver_fleet_owner';

// ============================================================
// Pending signup
// ============================================================

export interface PendingSignup {
  id: string;

  firstName: string;
  lastName: string;

  /**
   * Optional email address.
   *
   * Phone remains the mandatory primary signup channel.
   */
  email: string | null;

  /**
   * Legacy contact fields retained for compatibility with
   * the existing pending_signups schema.
   *
   * New signups use:
   *   contactType = 'phone'
   *   contactValue = normalized phone number
   */
  contactType: SignupContactType;
  contactValue: string;

  passwordHash: string;
  role: PublicSignupRole;

  // ----------------------------------------------------------
  // Provider registration fields
  // ----------------------------------------------------------

  /**
   * Required for:
   *   - driver
   *   - driver_fleet_owner
   */
  licenseNumber: string | null;
  licenseExpiry: Date | null;

  /**
   * Required for:
   *   - fleet_owner
   *   - driver_fleet_owner
   */
  businessName: string | null;

  // ----------------------------------------------------------
  // Legacy local-OTP fields
  //
  // Retained for historical pending-signup rows and schema
  // compatibility. Provider-managed OTP is now the source
  // of truth for new signup verification.
  // ----------------------------------------------------------

  otpHash: string | null;
  otpExpiresAt: Date | null;
  otpAttempts: number;
  otpVerifiedAt: Date | null;
  lastOtpSentAt: Date;

  // ----------------------------------------------------------
  // Provider-managed OTP session state
  // ----------------------------------------------------------

  otpProvider: string | null;
  otpProviderSessionId: string | null;

  /**
   * Sensitive provider credential.
   *
   * Repository queries that do not require provider
   * communication must not select this field.
   */
  otpProviderSessionToken: string | null;

  otpProviderExpiresAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Create pending signup
// ============================================================

export interface CreatePendingSignupData {
  firstName: string;
  lastName: string;

  /**
   * Optional email.
   */
  email: string | null;

  /**
   * New signup flow uses phone as the primary
   * verification contact.
   */
  contactType: SignupContactType;
  contactValue: string;

  passwordHash: string;
  role: PublicSignupRole;

  // ----------------------------------------------------------
  // Provider registration fields
  // ----------------------------------------------------------

  /**
   * Required for:
   *   - driver
   *   - driver_fleet_owner
   */
  licenseNumber: string | null;
  licenseExpiry: Date | null;

  /**
   * Required for:
   *   - fleet_owner
   *   - driver_fleet_owner
   */
  businessName: string | null;

  // ----------------------------------------------------------
  // Provider-managed OTP state
  // ----------------------------------------------------------

  otpProvider: string;
  otpProviderSessionId: string;
  otpProviderSessionToken: string;
  otpProviderExpiresAt: Date;
}
