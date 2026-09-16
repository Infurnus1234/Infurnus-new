export type LoginOtpChannel = 'sms' | 'email';

// ============================================================
// Create Login Challenge
// ============================================================

export interface CreateLoginChallengeData {
  userId: string;

  otpProvider: string;

  otpChannel: LoginOtpChannel;

  providerSessionId: string;

  encryptedProviderSessionToken: string;

  providerExpiresAt: Date;

  expiresAt: Date;

  lastOtpSentAt: Date;
}

// ============================================================
// Login Challenge Provider Session
// ============================================================

export interface LoginChallengeProviderSession {
  id: string;

  userId: string;

  otpProvider: string;

  otpChannel: LoginOtpChannel;

  providerSessionId: string;

  encryptedProviderSessionToken: string;

  providerExpiresAt: Date;

  expiresAt: Date;

  verifiedAt: Date | null;

  consumedAt: Date | null;
}

// ============================================================
// Login Challenge Resend Claim
// ============================================================

export interface LoginChallengeResendClaim {
  id: string;

  userId: string;

  otpProvider: string;

  otpChannel: LoginOtpChannel;

  providerSessionId: string;

  encryptedProviderSessionToken: string;

  providerExpiresAt: Date;

  expiresAt: Date;

  lastOtpSentAt: Date;
}

// ============================================================
// Consume Login Challenge Result
// ============================================================

export interface ConsumeLoginChallengeResult {
  status: 'consumed' | 'not_found' | 'already_consumed' | 'expired';

  userId?: string;

  role?: string;
}
