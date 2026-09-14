export interface CreateLoginChallengeData {
  userId: string;
  otpProvider: string;
  providerSessionId: string;
  encryptedProviderSessionToken: string;
  providerExpiresAt: Date;
  expiresAt: Date;
  lastOtpSentAt: Date;
}

export interface LoginChallengeProviderSession {
  id: string;
  userId: string;
  otpProvider: string;
  providerSessionId: string;
  encryptedProviderSessionToken: string;
  providerExpiresAt: Date;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface LoginChallengeResendClaim {
  id: string;
  userId: string;
  otpProvider: string;
  providerSessionId: string;
  encryptedProviderSessionToken: string;
  providerExpiresAt: Date;
  expiresAt: Date;
  lastOtpSentAt: Date;
}

export interface ConsumeLoginChallengeResult {
  status: 'consumed' | 'not_found' | 'already_consumed' | 'expired';
  userId?: string;
  role?: string;
}
