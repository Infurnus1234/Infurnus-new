export interface OtpProvider {
  sendSmsOtp(phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }>;

  sendEmailOtp(email: string): Promise<{
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

  resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }>;
}
