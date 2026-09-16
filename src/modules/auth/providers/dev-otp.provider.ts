import crypto from 'node:crypto';
import type { OtpProvider } from './otp.provider.js';

type DevOtpSession = {
  phone: string;
  otp: string;
  expiresAt: number;
  attempts: number;
};

export class DevOtpProvider implements OtpProvider {
  private readonly sessions = new Map<string, DevOtpSession>();

  async sendSmsOtp(phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    const sessionToken = `dev-token-${crypto.randomUUID()}`;
    const sessionId = `dev-session-${crypto.randomUUID()}`;
    const otp = '123456';
    const expiresAt = Date.now() + 10 * 60 * 1000;

    this.sessions.set(sessionToken, {
      phone,
      otp,
      expiresAt,
      attempts: 0,
    });

    console.log(`[DEV OTP] ${phone}: ${otp}`);

    return {
      sessionId,
      sessionToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async sendEmailOtp(email: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    const sessionToken = `dev-token-${crypto.randomUUID()}`;
    const sessionId = `dev-session-${crypto.randomUUID()}`;
    const otp = '123456';
    const expiresAt = Date.now() + 10 * 60 * 1000;

    this.sessions.set(sessionToken, {
      phone: email, // Reusing field for simplicity in dev provider
      otp,
      expiresAt,
      attempts: 0,
    });

    console.log(`[DEV OTP EMAIL] ${email}: ${otp}`);

    return {
      sessionId,
      sessionToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async verifySmsOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    const session = this.sessions.get(sessionToken);

    if (!session || Date.now() > session.expiresAt) {
      return {
        verified: false,
        attemptsRemaining: 0,
      };
    }

    session.attempts += 1;

    if (session.otp === otp) {
      this.sessions.delete(sessionToken);

      return {
        verified: true,
        attemptsRemaining: 10,
      };
    }

    return {
      verified: false,
      attemptsRemaining: Math.max(0, 10 - session.attempts),
    };
  }

  async resendSmsOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    const session = this.sessions.get(sessionToken);

    if (!session || Date.now() > session.expiresAt) {
      return {
        expiresAt: new Date().toISOString(),
      };
    }

    session.expiresAt = Date.now() + 10 * 60 * 1000;

    console.log(`[DEV OTP SMS] ${session.phone}: ${session.otp}`);

    return {
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  async resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    const session = this.sessions.get(sessionToken);

    if (!session || Date.now() > session.expiresAt) {
      return {
        expiresAt: new Date().toISOString(),
      };
    }

    session.expiresAt = Date.now() + 10 * 60 * 1000;

    console.log(`[DEV OTP EMAIL RESEND] ${session.phone}: ${session.otp}`);

    return {
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }
}
