import type { OtpProvider } from './otp.provider.js';

export class DevOtpProvider implements OtpProvider {
  async sendSmsOtp(_phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    return {
      sessionId: 'dev-session-id',
      sessionToken: 'dev-session-token',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async verifySmsOtp(
    _sessionToken: string,
    _otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    return {
      verified: false,
      attemptsRemaining: 0,
    };
  }

  async resendSmsOtp(_sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return {
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }
}
