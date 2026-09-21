import { AppError } from '../../../common/errors/app-error.js';
import type { OtpProvider } from './otp.provider.js';
import { ResendOtpProvider } from './resend-otp.provider.js';

const SENDMATOR_TOKEN_PREFIX = 'sendmator:';
const RESEND_TOKEN_PREFIX = 'resend:';

export class FallbackOtpProvider implements OtpProvider {
  constructor(
    private readonly sendmatorProvider: OtpProvider,
    private readonly resendProvider?: ResendOtpProvider,
  ) {}

  // ==========================================================
  // SMS � Sendmator only
  // ==========================================================

  async sendSmsOtp(phone: string) {
    const result = await this.sendmatorProvider.sendSmsOtp(phone);

    return {
      ...result,
      sessionToken: `${SENDMATOR_TOKEN_PREFIX}${result.sessionToken}`,
    };
  }

  async verifySmsOtp(sessionToken: string, otp: string) {
    if (!sessionToken.startsWith(SENDMATOR_TOKEN_PREFIX)) {
      throw new AppError('OTP_PROVIDER_SESSION_INVALID', 'Invalid SMS OTP provider session', 400);
    }

    return this.sendmatorProvider.verifySmsOtp(
      sessionToken.slice(SENDMATOR_TOKEN_PREFIX.length),
      otp,
    );
  }

  async resendSmsOtp(sessionToken: string) {
    if (!sessionToken.startsWith(SENDMATOR_TOKEN_PREFIX)) {
      throw new AppError('OTP_PROVIDER_SESSION_INVALID', 'Invalid SMS OTP provider session', 400);
    }

    return this.sendmatorProvider.resendSmsOtp(sessionToken.slice(SENDMATOR_TOKEN_PREFIX.length));
  }

  // ==========================================================
  // EMAIL � Sendmator ? Resend fallback
  // ==========================================================

  async sendEmailOtp(email: string) {
    try {
      const result = await this.sendmatorProvider.sendEmailOtp(email);

      return {
        ...result,
        sessionToken: `${SENDMATOR_TOKEN_PREFIX}${result.sessionToken}`,
      };
    } catch (error: unknown) {
      if (!this.resendProvider || !this.isProviderSendFailure(error)) {
        throw error;
      }

      const result = await this.resendProvider.sendEmailOtp(email);

      return {
        ...result,
        sessionToken: `${RESEND_TOKEN_PREFIX}${result.sessionToken}`,
      };
    }
  }

  async verifyEmailOtp(sessionToken: string, otp: string) {
    if (sessionToken.startsWith(SENDMATOR_TOKEN_PREFIX)) {
      return this.sendmatorProvider.verifyEmailOtp(
        sessionToken.slice(SENDMATOR_TOKEN_PREFIX.length),
        otp,
      );
    }

    if (sessionToken.startsWith(RESEND_TOKEN_PREFIX)) {
      if (!this.resendProvider) {
        throw new AppError(
          'OTP_PROVIDER_NOT_CONFIGURED',
          'Resend email OTP provider is not configured',
          500,
        );
      }

      return this.resendProvider.verifyEmailOtp(
        sessionToken.slice(RESEND_TOKEN_PREFIX.length),
        otp,
      );
    }

    throw new AppError('OTP_PROVIDER_SESSION_INVALID', 'Invalid email OTP provider session', 400);
  }

  async resendEmailOtp(sessionToken: string) {
    if (sessionToken.startsWith(SENDMATOR_TOKEN_PREFIX)) {
      return this.sendmatorProvider.resendEmailOtp(
        sessionToken.slice(SENDMATOR_TOKEN_PREFIX.length),
      );
    }

    if (sessionToken.startsWith(RESEND_TOKEN_PREFIX)) {
      if (!this.resendProvider) {
        throw new AppError(
          'OTP_PROVIDER_NOT_CONFIGURED',
          'Resend email OTP provider is not configured',
          500,
        );
      }

      return this.resendProvider.resendEmailOtp(sessionToken.slice(RESEND_TOKEN_PREFIX.length));
    }

    throw new AppError('OTP_PROVIDER_SESSION_INVALID', 'Invalid email OTP provider session', 400);
  }

  // ==========================================================
  // Provider Failure Detection
  // ==========================================================

  private isProviderSendFailure(error: unknown): boolean {
    return error instanceof AppError && error.code === 'OTP_PROVIDER_SEND_FAILED';
  }
}
