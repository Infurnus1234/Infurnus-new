import { AppError } from '../../../common/errors/app-error.js';
import type { OtpProvider, SmsOtpProvider } from './otp.provider.js';
import { ResendOtpProvider } from './resend-otp.provider.js';

const SENDMATOR_TOKEN_PREFIX = 'sendmator:';
const RESEND_TOKEN_PREFIX = 'resend:';

export class FallbackOtpProvider implements OtpProvider {
  constructor(
    private readonly sendmatorProvider: OtpProvider | undefined,
    private readonly resendProvider?: ResendOtpProvider,
    private readonly smsProvider?: { name: string; adapter: SmsOtpProvider },
  ) {}

  // ==========================================================
  // SMS � Sendmator only
  // ==========================================================

  async sendSmsOtp(phone: string) {
    const adapter = this.smsProvider?.adapter ?? this.requireSendmator();
    const name = this.smsProvider?.name ?? 'sendmator';
    const result = await adapter.sendSmsOtp(phone);

    return {
      ...result,
      provider: name,
      sessionToken: `${name}:${result.sessionToken}`,
    };
  }

  async verifySmsOtp(sessionToken: string, otp: string) {
    const { adapter, token } = this.resolveSms(sessionToken);
    return adapter.verifySmsOtp(token, otp);
  }

  async resendSmsOtp(sessionToken: string) {
    const { adapter, token } = this.resolveSms(sessionToken);
    return adapter.resendSmsOtp(token);
  }

  // ==========================================================
  // EMAIL � Sendmator ? Resend fallback
  // ==========================================================

  async sendEmailOtp(email: string) {
    try {
      if (!this.sendmatorProvider) {
        throw new AppError('OTP_PROVIDER_SEND_FAILED', 'Email OTP provider is not configured', 503);
      }
      const result = await this.sendmatorProvider.sendEmailOtp(email);

      return {
        ...result,
        provider: 'sendmator',
        sessionToken: `${SENDMATOR_TOKEN_PREFIX}${result.sessionToken}`,
      };
    } catch (error: unknown) {
      if (!this.resendProvider || !this.isProviderSendFailure(error)) {
        throw error;
      }

      const result = await this.resendProvider.sendEmailOtp(email);

      return {
        ...result,
        provider: 'resend',
        sessionToken: `${RESEND_TOKEN_PREFIX}${result.sessionToken}`,
      };
    }
  }

  async verifyEmailOtp(sessionToken: string, otp: string) {
    if (sessionToken.startsWith(SENDMATOR_TOKEN_PREFIX)) {
      return this.requireSendmator().verifyEmailOtp(
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
      return this.requireSendmator().resendEmailOtp(
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

  private requireSendmator(): OtpProvider {
    if (!this.sendmatorProvider) {
      throw new AppError('OTP_PROVIDER_NOT_CONFIGURED', 'OTP provider is not configured', 503);
    }
    return this.sendmatorProvider;
  }

  private resolveSms(sessionToken: string) {
    if (this.smsProvider && sessionToken.startsWith(`${this.smsProvider.name}:`)) {
      return {
        adapter: this.smsProvider.adapter,
        token: sessionToken.slice(this.smsProvider.name.length + 1),
      };
    }
    // Preserve outstanding SendMator sessions when switching providers.
    if (sessionToken.startsWith(SENDMATOR_TOKEN_PREFIX)) {
      return {
        adapter: this.requireSendmator(),
        token: sessionToken.slice(SENDMATOR_TOKEN_PREFIX.length),
      };
    }
    throw new AppError('OTP_PROVIDER_SESSION_INVALID', 'Invalid SMS OTP provider session', 400);
  }
}
