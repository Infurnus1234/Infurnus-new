// ============================================================
// Signup contact type
// ============================================================

export type SignupContactType = 'email' | 'phone';

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
   * New signups always use:
   *   contactType = 'phone'
   *   contactValue = normalized phone number
   */
  contactType: SignupContactType;
  contactValue: string;

  passwordHash: string;
  role: string;

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
   * New signup flow always uses phone as the primary
   * verification contact.
   */
  contactType: SignupContactType;
  contactValue: string;

  passwordHash: string;
  role: string;

  // ----------------------------------------------------------
  // Provider-managed OTP state
  // ----------------------------------------------------------

  otpProvider: string;
  otpProviderSessionId: string;
  otpProviderSessionToken: string;
  otpProviderExpiresAt: Date;
}
