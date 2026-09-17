import { Sendmator } from '@sendmator/node';

import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';
import type { OtpProvider } from './otp.provider.js';

interface SendmatorSendResponse {
  session_id?: string;
  session_token?: string;
  expires_at?: string;
  channels_sent?: unknown;
}

interface SendmatorVerifyResponse {
  verified?: boolean;
  attempts_remaining?: number;
}

interface SendmatorResendResponse {
  expires_at?: string;
}

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

  // ============================================================
  // SMS OTP
  // ============================================================

  async sendSmsOtp(phone: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    try {
      const response = (await this.client.otp.send({
        channels: ['sms'],
        recipients: {
          sms: phone,
        },
      })) as SendmatorSendResponse;

      console.info('Sendmator SMS OTP send completed', {
        sessionIdPresent: Boolean(response.session_id),
        sessionTokenPresent: Boolean(response.session_token),
        expiresAtPresent: Boolean(response.expires_at),
        channelsSent: response.channels_sent,
      });

      const sessionId = response.session_id;
      const sessionToken = response.session_token;
      const expiresAt = response.expires_at;

      if (
        typeof sessionId !== 'string' ||
        sessionId.length === 0 ||
        typeof sessionToken !== 'string' ||
        sessionToken.length === 0 ||
        typeof expiresAt !== 'string' ||
        expiresAt.length === 0
      ) {
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
      if (error instanceof AppError) {
        throw error;
      }

      console.error('Sendmator SMS OTP send failed', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });

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
      const response = (await this.client.otp.verify({
        session_token: sessionToken,
        otps: {
          sms: otp,
        },
      })) as SendmatorVerifyResponse;

      return this.parseVerificationResponse(response);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }

      console.error('Sendmator SMS OTP verification failed', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });

      throw new AppError('OTP_PROVIDER_VERIFY_FAILED', 'Failed to verify verification code', 502);
    }
  }

  async resendSmsOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return this.resendOtp(sessionToken, 'SMS');
  }

  // ============================================================
  // EMAIL OTP
  // ============================================================

  async sendEmailOtp(email: string): Promise<{
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  }> {
    try {
      const response = (await this.client.otp.send({
        channels: ['email'],
        recipients: {
          email,
        },
      })) as SendmatorSendResponse;

      console.info('Sendmator email OTP send completed', {
        sessionIdPresent: Boolean(response.session_id),
        sessionTokenPresent: Boolean(response.session_token),
        expiresAtPresent: Boolean(response.expires_at),
        channelsSent: response.channels_sent,
      });

      const sessionId = response.session_id;
      const sessionToken = response.session_token;
      const expiresAt = response.expires_at;

      if (
        typeof sessionId !== 'string' ||
        sessionId.length === 0 ||
        typeof sessionToken !== 'string' ||
        sessionToken.length === 0 ||
        typeof expiresAt !== 'string' ||
        expiresAt.length === 0
      ) {
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
      if (error instanceof AppError) {
        throw error;
      }

      console.error('Sendmator email OTP send failed', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });

      throw new AppError('OTP_PROVIDER_SEND_FAILED', 'Failed to send verification code', 502);
    }
  }

  async verifyEmailOtp(
    sessionToken: string,
    otp: string,
  ): Promise<{
    verified: boolean;
    attemptsRemaining: number;
  }> {
    try {
      const response = (await this.client.otp.verify({
        session_token: sessionToken,
        otps: {
          email: otp,
        },
      })) as SendmatorVerifyResponse;

      return this.parseVerificationResponse(response);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }

      console.error('Sendmator email OTP verification failed', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });

      throw new AppError('OTP_PROVIDER_VERIFY_FAILED', 'Failed to verify verification code', 502);
    }
  }

  async resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return this.resendOtp(sessionToken, 'EMAIL');
  }

  // ============================================================
  // Shared Verification Response Validation
  // ============================================================

  private parseVerificationResponse(response: SendmatorVerifyResponse): {
    verified: boolean;
    attemptsRemaining: number;
  } {
    const verified = response.verified === true;
    const attemptsRemaining = response.attempts_remaining;

    if (
      typeof attemptsRemaining !== 'number' ||
      !Number.isInteger(attemptsRemaining) ||
      attemptsRemaining < 0
    ) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid verification response',
        502,
      );
    }

    return {
      verified,
      attemptsRemaining,
    };
  }

  // ============================================================
  // Shared Resend
  // ============================================================

  private async resendOtp(
    sessionToken: string,
    channel: 'SMS' | 'EMAIL',
  ): Promise<{
    expiresAt: string;
  }> {
    try {
      const response = (await this.client.otp.resend({
        session_token: sessionToken,
      })) as SendmatorResendResponse;

      const expiresAt = response.expires_at;

      if (typeof expiresAt !== 'string' || expiresAt.length === 0) {
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
      if (error instanceof AppError) {
        throw error;
      }

      console.error(`Sendmator ${channel} OTP resend failed`, {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });

      throw new AppError('OTP_PROVIDER_RESEND_FAILED', 'Failed to resend verification code', 502);
    }
  }
}
