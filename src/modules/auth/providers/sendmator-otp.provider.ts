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

      return this.parseSendResponse(response);
    } catch (error: unknown) {
      this.logProviderError('Sendmator SMS OTP send failed', error);

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
      const response = (await this.client.otp.verify({
        session_token: sessionToken,
        otps: {
          sms: otp,
        },
      })) as SendmatorVerifyResponse;

      return this.parseVerificationResponse(response);
    } catch (error: unknown) {
      this.logProviderError('Sendmator SMS OTP verification failed', error);

      if (error instanceof AppError) {
        throw error;
      }

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

      return this.parseSendResponse(response);
    } catch (error: unknown) {
      this.logProviderError('Sendmator email OTP send failed', error);

      if (error instanceof AppError) {
        throw error;
      }

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
      this.logProviderError('Sendmator email OTP verification failed', error);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('OTP_PROVIDER_VERIFY_FAILED', 'Failed to verify verification code', 502);
    }
  }

  async resendEmailOtp(sessionToken: string): Promise<{
    expiresAt: string;
  }> {
    return this.resendOtp(sessionToken, 'EMAIL');
  }

  // ============================================================
  // SEND RESPONSE VALIDATION
  // ============================================================

  private parseSendResponse(response: SendmatorSendResponse): {
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
  } {
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
  }

  // ============================================================
  // VERIFICATION RESPONSE VALIDATION
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
  // RESEND
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

      console.info(`Sendmator ${channel} OTP resend completed`, {
        expiresAtPresent: true,
      });

      return {
        expiresAt,
      };
    } catch (error: unknown) {
      this.logProviderError(`Sendmator ${channel} OTP resend failed`, error);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('OTP_PROVIDER_RESEND_FAILED', 'Failed to resend verification code', 502);
    }
  }

  // ============================================================
  // SAFE PROVIDER ERROR LOGGING
  // ============================================================

  private logProviderError(context: string, error: unknown): void {
    if (error instanceof AppError) {
      console.error(context, {
        errorType: 'AppError',
        code: error.code,
        statusCode: error.statusCode,
        message: error.message,
      });

      return;
    }

    if (error instanceof Error) {
      const providerError = error as Error & {
        status?: number;
        statusCode?: number;
        code?: string;
        type?: string;
        name?: string;
      };

      console.error(context, {
        errorType: error.constructor.name,
        name: providerError.name,
        code: providerError.code,
        type: providerError.type,
        status: providerError.status,
        statusCode: providerError.statusCode,
        message: providerError.message,
      });

      return;
    }

    console.error(context, {
      errorType: typeof error,
    });
  }
}
