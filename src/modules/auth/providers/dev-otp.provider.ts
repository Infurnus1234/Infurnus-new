import crypto from 'node:crypto';

import type { OtpProvider } from './otp.provider.js';

type OtpChannel = 'sms' | 'email';

type DevOtpSession = {
  contact: string;
  channel: OtpChannel;
  otp: string;
  expiresAt: number;
  attempts: number;
};

export class DevOtpProvider implements OtpProvider {
  private readonly sessions = new Map<string, DevOtpSession>();

  // ============================================================
  // SMS OTP
  // ============================================================

  async sendSmsOtp(phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    return this.sendOtp(phone, 'sms');
  }

  async verifySmsOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    return this.verifyOtp(sessionToken, otp, 'sms');
  }

  async resendSmsOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return this.resendOtp(sessionToken, 'sms');
  }

  // ============================================================
  // EMAIL OTP
  // ============================================================

  async sendEmailOtp(email: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    return this.sendOtp(email, 'email');
  }

  async verifyEmailOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    return this.verifyOtp(sessionToken, otp, 'email');
  }

  async resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return this.resendOtp(sessionToken, 'email');
  }

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  private async sendOtp(
    contact: string,
    channel: OtpChannel,
  ): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    const sessionToken = `dev-token-${crypto.randomUUID()}`;
    const sessionId = `dev-session-${crypto.randomUUID()}`;

    // Development-only fixed OTP.
    const otp = '123456';

    const expiresAt = Date.now() + 10 * 60 * 1000;

    this.sessions.set(sessionToken, {
      contact,
      channel,
      otp,
      expiresAt,
      attempts: 0,
    });

    console.log(`[DEV OTP] ${channel.toUpperCase()} ${contact}: ${otp}`);

    return {
      sessionId,
      sessionToken,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  private async verifyOtp(
    sessionToken: string,
    otp: string,
    channel: OtpChannel,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      return {
        verified: false,
        attemptsRemaining: 0,
      };
    }

    if (session.channel !== channel) {
      return {
        verified: false,
        attemptsRemaining: 0,
      };
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionToken);

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

  private async resendOtp(
    sessionToken: string,
    channel: OtpChannel,
  ): Promise<{
    expiresAt: string;
  }> {
    const session = this.sessions.get(sessionToken);

    if (!session || session.channel !== channel) {
      return {
        expiresAt: new Date().toISOString(),
      };
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionToken);

      return {
        expiresAt: new Date().toISOString(),
      };
    }

    session.expiresAt = Date.now() + 10 * 60 * 1000;

    console.log(`[DEV OTP RESEND] ${channel.toUpperCase()} ${session.contact}: ${session.otp}`);

    return {
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }
}
