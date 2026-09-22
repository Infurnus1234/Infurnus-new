import { AppError } from '../../../common/errors/app-error.js';
import {
  decryptSecret,
  encryptSecret,
} from '../../../common/crypto/encryption.js';
import { hashPassword } from '../utils/password.js';

import type { OtpProvider } from '../providers/otp.provider.js';
import type { AccountRepository } from '../repositories/account.repository.js';
import type {
  CreatePasswordResetChallengeData,
  PasswordResetRepository,
} from '../repositories/password-reset.repository.js';

export class PasswordResetService {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly passwordResetRepository: PasswordResetRepository,
    private readonly otpProvider: OtpProvider,
  ) {}

  async requestReset(
    email: string,
  ): Promise<{ challengeId: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();

    const user =
      await this.accountRepository.findUserByEmail(normalizedEmail);

    /*
     * Do not reveal whether an account exists.
     * This prevents email/account enumeration.
     */
    if (!user) {
      return { challengeId: null };
    }

    const providerSession =
      await this.otpProvider.sendEmailOtp(normalizedEmail);

    const providerExpiresAt = new Date(providerSession.expiresAt);

    if (Number.isNaN(providerExpiresAt.getTime())) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_EXPIRY',
        'OTP provider returned an invalid expiry',
        502,
      );
    }

    const challengeData: CreatePasswordResetChallengeData = {
      userId: user.id,
      email: normalizedEmail,
      otpProvider: 'sendmator',
      providerSessionId: providerSession.sessionId,
      encryptedProviderSessionToken: encryptSecret(
        providerSession.sessionToken,
      ),
      providerExpiresAt,
      expiresAt: providerExpiresAt,
      lastOtpSentAt: new Date(),
    };

    const challenge =
      await this.passwordResetRepository.create(challengeData);

    return {
      challengeId: challenge.id,
    };
  }

  async resetPassword(
    challengeId: string,
    otp: string,
    newPassword: string,
  ): Promise<void> {
    const challenge =
      await this.passwordResetRepository.findActiveById(challengeId);

    if (!challenge) {
      throw new AppError(
        'PASSWORD_RESET_CHALLENGE_INVALID',
        'Password reset challenge is invalid or expired',
        400,
      );
    }

    let providerSessionToken: string;

    try {
      providerSessionToken = decryptSecret(
        challenge.encryptedProviderSessionToken,
      );
    } catch {
      throw new AppError(
        'PASSWORD_RESET_SESSION_INVALID',
        'Password reset session is invalid',
        400,
      );
    }

    if (!providerSessionToken) {
      throw new AppError(
        'PASSWORD_RESET_SESSION_INVALID',
        'Password reset session is invalid',
        400,
      );
    }

    let verification;

    try {
      verification = await this.otpProvider.verifyEmailOtp(
        providerSessionToken,
        otp,
      );
    } catch {
      throw new AppError(
        'PASSWORD_RESET_OTP_FAILED',
        'Unable to verify password reset OTP',
        400,
      );
    }

    if (!verification.verified) {
      throw new AppError(
        'PASSWORD_RESET_OTP_INVALID',
        'Invalid password reset OTP',
        400,
      );
    }

    const passwordHash = await hashPassword(newPassword);

    const updated = await this.accountRepository.updatePassword(
      challenge.userId,
      passwordHash,
    );

    if (!updated) {
      throw new AppError(
        'PASSWORD_RESET_USER_UPDATE_FAILED',
        'Unable to update password',
        500,
      );
    }

    const consumed =
      await this.passwordResetRepository.consume(challenge.id);

    if (!consumed) {
      throw new AppError(
        'PASSWORD_RESET_CHALLENGE_CONSUME_FAILED',
        'Password reset challenge could not be consumed',
        400,
      );
    }
  }
}