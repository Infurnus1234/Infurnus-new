import { AppError } from '../../../common/errors/app-error.js';
import { encryptSecret } from '../../../common/crypto/encryption.js';

import type { LoginRepository } from '../repositories/login.repository.js';
import type { LoginChallengeRepository } from '../repositories/login-challenge.repository.js';

import type { OtpProvider } from '../providers/otp.provider.js';

import { verifyPassword } from '../utils/password.js';
import { normalizeEmail, normalizePhone } from '../utils/contact.js';

import type { LoginInput } from '../types/login.js';

export interface LoginChallengeResult {
  challengeId: string;
  expiresAt: Date;
}

export class LoginService {
  constructor(
    private readonly repository: LoginRepository,
    private readonly loginChallengeRepository: LoginChallengeRepository,
    private readonly otpProvider: OtpProvider,
  ) {}

  async authenticate(input: LoginInput, channel: 'phone' | 'email' = 'phone'): Promise<LoginChallengeResult> {
    const hasEmail = Boolean(input.email);
    const hasPhone = Boolean(input.phone);

    if (hasEmail === hasPhone) {
      throw new AppError('INVALID_LOGIN', 'Provide either email or phone number', 400);
    }

    const identity = hasEmail
      ? await this.repository.findByEmail(normalizeEmail(input.email!))
      : await this.repository.findByPhone(normalizePhone(input.phone!));

    if (!identity) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email/phone or password', 401);
    }

    if (identity.status !== 'active') {
      throw new AppError('ACCOUNT_NOT_ACTIVE', 'Account is not active', 401);
    }

    const validPassword = await verifyPassword(identity.passwordHash, input.password);

    if (!validPassword) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email/phone or password', 401);
    }

    let providerSession;

    if (channel === 'email') {
      if (!identity.email) {
        throw new AppError('EMAIL_NOT_CONFIGURED', 'Account email address is not configured', 400);
      }
      providerSession = await this.otpProvider.sendEmailOtp(identity.email);
    } else {
      if (!identity.phone) {
        throw new AppError('PHONE_NOT_CONFIGURED', 'Account phone number is not configured', 500);
      }
      providerSession = await this.otpProvider.sendSmsOtp(identity.phone);
    }

    if (!providerSession.sessionId || !providerSession.sessionToken || !providerSession.expiresAt) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid session response',
        502,
      );
    }

    const providerExpiresAt = new Date(providerSession.expiresAt);

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

    /*
     * Provider session token is credential-like
     * sensitive material. Store only its encrypted form.
     */
    const encryptedProviderSessionToken = encryptSecret(providerSession.sessionToken);

    /*
     * Local challenge lifetime is bounded by the
     * provider session lifetime.
     */
    const expiresAt = providerExpiresAt;

    const challenge = await this.loginChallengeRepository.create({
      userId: identity.id,
      otpProvider: 'sendmator',
      providerSessionId: providerSession.sessionId,
      encryptedProviderSessionToken,
      providerExpiresAt,
      expiresAt,
      lastOtpSentAt: new Date(),
    });

    return {
      challengeId: challenge.id,
      expiresAt,
    };
  }
}
