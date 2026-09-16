export interface OtpProvider {
  // ============================================================
  // SMS OTP
  // ============================================================

  sendSmsOtp(phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }>;

  verifySmsOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }>;

  resendSmsOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }>;

  // ============================================================
  // EMAIL OTP
  // ============================================================

  sendEmailOtp(email: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }>;

  verifyEmailOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }>;

  resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }>;
}
