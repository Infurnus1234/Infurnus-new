import { Sendmator } from '@sendmator/node';

import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';
import type { OtpProvider } from './otp.provider.js';

export class SendmatorOtpProvider implements OtpProvider {
  private readonly client: Sendmator;

  constructor(apiKey = env.SENDMATOR_API_KEY) {
    if (!apiKey) {
      throw new AppError('OTP_PROVIDER_NOT_CONFIGURED', 'OTP provider is not configured', 500);
    }

    this.client = new Sendmator({
      apiKey,
    });
  }

  async sendSmsOtp(phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    try {
      const response = await this.client.otp.send({
        channels: ['sms'],
        recipients: {
          sms: phone,
        },
      });

      // Safe diagnostic logging.
      // NEVER log the session token or OTP.
      console.log('Sendmator OTP send response:', {
        sessionId: response.session_id,
        expiresAt: response.expires_at,
        hasSessionToken: Boolean(response.session_token),
        channelsSent: response.channels_sent,
        message: response.message,
        config: response.config,
      });

      const sessionId = response.session_id;
      const sessionToken = response.session_token;
      const expiresAt = response.expires_at;

      if (!sessionId || !sessionToken || !expiresAt) {
        throw new AppError(
          'OTP_PROVIDER_INVALID_RESPONSE',
          'OTP provider returned an invalid session response',
          502,
        );
      }

      return {
        sessionId,
        sessionToken,
        expiresAt,
      };
    } catch (error: unknown) {
      console.error('Sendmator OTP send failed:', error);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('OTP_PROVIDER_SEND_FAILED', 'Failed to send verification code', 502);
    }
  }

  async sendEmailOtp(email: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    try {
      const response = await this.client.otp.send({
        channels: ['email'],
        recipients: {
          email,
        },
      });

      console.log('Sendmator OTP email send response:', {
        sessionId: response.session_id,
        expiresAt: response.expires_at,
        hasSessionToken: Boolean(response.session_token),
        channelsSent: response.channels_sent,
        message: response.message,
      });

      const sessionId = response.session_id;
      const sessionToken = response.session_token;
      const expiresAt = response.expires_at;

      if (!sessionId || !sessionToken || !expiresAt) {
        throw new AppError(
          'OTP_PROVIDER_INVALID_RESPONSE',
          'OTP provider returned an invalid session response',
          502,
        );
      }

      return {
        sessionId,
        sessionToken,
        expiresAt,
      };
    } catch (error: unknown) {
      console.error('Sendmator OTP email send failed:', error);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('OTP_PROVIDER_SEND_FAILED', 'Failed to send verification code', 502);
    }
  }

  async verifySmsOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    try {
      const response = await this.client.otp.verify({
        session_token: sessionToken,
        otps: {
          sms: otp,
          email: otp, // Try both since same interface
        },
      });

      return {
        verified: response.verified === true,
        attemptsRemaining: response.attempts_remaining,
      };
    } catch (error: unknown) {
      console.error('Sendmator OTP verification failed:', error);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('OTP_PROVIDER_VERIFY_FAILED', 'Failed to verify verification code', 502);
    }
  }

  async resendSmsOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    try {
      const response = await this.client.otp.resend({
        session_token: sessionToken,
      });

      const expiresAt = response.expires_at;

      if (!expiresAt) {
        throw new AppError(
          'OTP_PROVIDER_INVALID_RESPONSE',
          'OTP provider returned an invalid expiry time',
          502,
        );
      }

      return {
        expiresAt,
      };
    } catch (error: unknown) {
      console.error('Sendmator OTP resend failed:', error);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('OTP_PROVIDER_RESEND_FAILED', 'Failed to resend verification code', 502);
    }
  }

  async resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return this.resendSmsOtp(sessionToken); // Same logic in Sendmator
  }
}
