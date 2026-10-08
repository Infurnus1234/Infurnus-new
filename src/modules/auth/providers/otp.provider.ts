export interface OtpProvider {
  // ============================================================
  // SMS OTP
  // ============================================================

  sendSmsOtp(phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
    provider?: string;
  }>;

  verifySmsOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number | null;
  }>;

  resendSmsOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }>;

  // ============================================================
  // EMAIL OTP
  // ============================================================

  sendEmailOtp(email: string): Promise<{
    provider?: string;
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }>;

  verifyEmailOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number | null;
  }>;

  resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }>;
}

export type SmsOtpProvider = Pick<OtpProvider, 'sendSmsOtp' | 'verifySmsOtp' | 'resendSmsOtp'>;
