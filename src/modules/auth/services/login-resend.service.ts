import { AppError } from '../../../common/errors/app-error.js';
import { decryptSecret } from '../../../common/crypto/encryption.js';
import type { LoginChallengeRepository } from '../repositories/login-challenge.repository.js';
import type { OtpProvider } from '../providers/otp.provider.js';

export interface LoginResendResult {
  expiresAt: Date;
}

export class LoginResendService {
  constructor(
    private readonly loginChallengeRepository: LoginChallengeRepository,
    private readonly otpProvider: OtpProvider,
    private readonly cooldownSeconds: number,
  ) {}

  async resend(challengeId: string, channel: 'phone' | 'email' = 'phone'): Promise<LoginResendResult> {
    if (!challengeId) {
      throw new AppError('INVALID_LOGIN_CHALLENGE', 'Invalid login challenge', 400);
    }

    const providerSession = await this.loginChallengeRepository.getProviderSession(challengeId);

    if (!providerSession) {
      throw new AppError('INVALID_LOGIN_CHALLENGE', 'Invalid or expired login challenge', 400);
    }

    if (providerSession.consumedAt) {
      throw new AppError(
        'LOGIN_CHALLENGE_ALREADY_CONSUMED',
        'Login challenge has already been consumed',
        400,
      );
    }

    if (providerSession.verifiedAt) {
      throw new AppError(
        'LOGIN_CHALLENGE_ALREADY_VERIFIED',
        'Login challenge has already been verified',
        400,
      );
    }

    if (providerSession.expiresAt.getTime() <= Date.now()) {
      throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);
    }

    const claim = await this.loginChallengeRepository.claimResend(
      challengeId,
      this.cooldownSeconds,
    );

    if (!claim) {
      throw new AppError(
        'OTP_RESEND_RATE_LIMITED',
        'Please wait before requesting another verification code',
        429,
      );
    }

    let providerSessionToken: string;

    try {
      providerSessionToken = decryptSecret(claim.encryptedProviderSessionToken);
    } catch {
      throw new AppError(
        'OTP_PROVIDER_SESSION_INVALID',
        'OTP verification session is invalid',
        500,
      );
    }

    const resendResult = channel === 'email'
      ? await this.otpProvider.resendEmailOtp(providerSessionToken)
      : await this.otpProvider.resendSmsOtp(providerSessionToken);

    const providerExpiresAt = new Date(resendResult.expiresAt);

    if (Number.isNaN(providerExpiresAt.getTime())) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid expiry time',
        502,
      );
    }

    if (providerExpiresAt.getTime() <= Date.now()) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an expired session',
        502,
      );
    }

    const updated = await this.loginChallengeRepository.updateProviderExpiry(
      challengeId,
      providerExpiresAt,
    );

    if (!updated) {
      throw new AppError(
        'LOGIN_RESEND_UPDATE_FAILED',
        'Failed to update login verification session',
        500,
      );
    }

    return {
      expiresAt: providerExpiresAt,
    };
  }
}
