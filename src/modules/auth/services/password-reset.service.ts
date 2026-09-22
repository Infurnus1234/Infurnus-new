import { createHash, randomBytes } from 'node:crypto';

import { AppError } from '../../../common/errors/app-error.js';
import { decryptSecret, encryptSecret } from '../../../common/crypto/encryption.js';

import type { OtpProvider } from '../providers/otp.provider.js';

import type {
  PasswordResetChallenge,
  PasswordResetRepository,
} from '../repositories/password-reset.repository.js';

import type { RefreshTokenRepository } from '../repositories/refresh-token.repository.js';

import type { UserCredentialsRepository } from '../repositories/user-credentials.repository.js';

import { hashPassword } from '../utils/password.js';

// ============================================================
// Constants
// ============================================================

const RESET_SESSION_BYTES = 32;

const GENERIC_RESET_SESSION_TTL_MS = 10 * 60 * 1000;

const GENERIC_PASSWORD_RESET_MESSAGE =
  'If an account exists for this email address, a password reset code has been sent.';

// ============================================================
// Result Types
// ============================================================

export interface ForgotPasswordResult {
  message: string;
  resetSessionToken: string;
  expiresAt: string;
}

export interface VerifyPasswordResetResult {
  resetSessionToken: string;
  expiresAt: string;
}

export interface ResetPasswordResult {
  message: string;
}

// ============================================================
// Password Reset Service
// ============================================================

export class PasswordResetService {
  constructor(
    private readonly passwordResetRepository: PasswordResetRepository,
    private readonly userCredentialsRepository: UserCredentialsRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly otpProvider: OtpProvider,
  ) {}

  // ==========================================================
  // Forgot Password
  // ==========================================================

  async forgotPassword(email: string): Promise<ForgotPasswordResult> {
    const normalizedEmail = email.trim().toLowerCase();

    // --------------------------------------------------------
    // Generate application-level reset session token first.
    //
    // This is generated even when the account does not exist.
    // This keeps the API response shape identical and avoids
    // leaking account existence through the response body.
    // --------------------------------------------------------

    const resetSessionToken = randomBytes(RESET_SESSION_BYTES).toString('hex');

    const resetSessionTokenHash = this.hashSessionToken(resetSessionToken);

    // --------------------------------------------------------
    // Resolve account
    // --------------------------------------------------------

    const user = await this.passwordResetRepository.findActiveUserByEmail(normalizedEmail);

    // --------------------------------------------------------
    // Unknown account
    //
    // Never reveal whether the email exists.
    //
    // The returned reset token is intentionally not persisted,
    // so it cannot be used to reset any account.
    // --------------------------------------------------------

    if (!user) {
      const genericExpiresAt = new Date(Date.now() + GENERIC_RESET_SESSION_TTL_MS);

      return {
        message: GENERIC_PASSWORD_RESET_MESSAGE,
        resetSessionToken,
        expiresAt: genericExpiresAt.toISOString(),
      };
    }

    // --------------------------------------------------------
    // Send OTP
    //
    // OtpProvider is responsible for:
    //
    // Sendmator -> Resend fallback
    //
    // The service does not generate or verify the provider OTP
    // itself.
    // --------------------------------------------------------

    let providerSession: {
      sessionId: string;
      sessionToken: string;
      expiresAt: string;
    };

    try {
      providerSession = await this.otpProvider.sendEmailOtp(normalizedEmail);
    } catch {
      throw new AppError(
        'OTP_PROVIDER_UNAVAILABLE',
        'Password reset service is temporarily unavailable',
        502,
      );
    }

    // --------------------------------------------------------
    // Validate provider expiry
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Encrypt provider session token
    //
    // Only the encrypted provider token is stored.
    // Plain provider credentials/session tokens never go into
    // the database.
    // --------------------------------------------------------

    let encryptedProviderSessionToken: string;

    try {
      encryptedProviderSessionToken = encryptSecret(providerSession.sessionToken);
    } catch {
      throw new AppError(
        'OTP_PROVIDER_SESSION_ENCRYPTION_FAILED',
        'Password reset service is temporarily unavailable',
        500,
      );
    }

    // --------------------------------------------------------
    // Store application reset challenge
    // --------------------------------------------------------

    const now = new Date();

    await this.passwordResetRepository.create({
      userId: user.id,
      email: normalizedEmail,
      sessionTokenHash: resetSessionTokenHash,
      providerSessionId: providerSession.sessionId,
      providerSessionTokenEncrypted: encryptedProviderSessionToken,
      expiresAt: providerExpiresAt,
      lastSentAt: now,
    });

    // --------------------------------------------------------
    // Generic response
    // --------------------------------------------------------

    return {
      message: GENERIC_PASSWORD_RESET_MESSAGE,
      resetSessionToken,
      expiresAt: providerExpiresAt.toISOString(),
    };
  }

  // ==========================================================
  // Verify Reset OTP
  // ==========================================================

  async verifyOtp(resetSessionToken: string, otp: string): Promise<VerifyPasswordResetResult> {
    // --------------------------------------------------------
    // Validate input
    // --------------------------------------------------------

    this.validateResetSessionToken(resetSessionToken);
    this.validateOtp(otp);

    const resetSessionTokenHash = this.hashSessionToken(resetSessionToken);

    // --------------------------------------------------------
    // Load reset challenge
    // --------------------------------------------------------

    const challenge =
      await this.passwordResetRepository.findBySessionTokenHash(resetSessionTokenHash);

    if (!challenge) {
      throw new AppError(
        'INVALID_PASSWORD_RESET_SESSION',
        'Invalid or expired password reset session',
        400,
      );
    }

    // --------------------------------------------------------
    // Validate local challenge state
    // --------------------------------------------------------

    this.ensureChallengeActive(challenge);

    // --------------------------------------------------------
    // Decrypt provider session token
    // --------------------------------------------------------

    let providerSessionToken: string;

    try {
      providerSessionToken = decryptSecret(challenge.providerSessionTokenEncrypted);
    } catch {
      throw new AppError(
        'OTP_PROVIDER_SESSION_INVALID',
        'Password reset verification session is invalid',
        500,
      );
    }

    // --------------------------------------------------------
    // Verify OTP through configured provider
    //
    // Sendmator / Resend provider owns OTP verification.
    // --------------------------------------------------------

    let verification: {
      verified: boolean;
      attemptsRemaining: number;
    };

    try {
      verification = await this.otpProvider.verifyEmailOtp(providerSessionToken, otp);
    } catch {
      throw new AppError(
        'OTP_PROVIDER_UNAVAILABLE',
        'OTP verification service is temporarily unavailable',
        502,
      );
    }

    // --------------------------------------------------------
    // Invalid OTP
    // --------------------------------------------------------

    if (!verification.verified) {
      if (verification.attemptsRemaining <= 0) {
        throw new AppError(
          'OTP_ATTEMPTS_EXCEEDED',
          'Maximum OTP verification attempts exceeded',
          429,
        );
      }

      throw new AppError('INVALID_OTP', 'Invalid OTP', 400);
    }

    // --------------------------------------------------------
    // Atomically mark reset challenge as verified
    // --------------------------------------------------------

    const markedVerified = await this.passwordResetRepository.markVerified(resetSessionTokenHash);

    if (!markedVerified) {
      throw new AppError(
        'INVALID_PASSWORD_RESET_SESSION',
        'Password reset session is no longer valid',
        400,
      );
    }

    return {
      resetSessionToken,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  // ==========================================================
  // Reset Password
  // ==========================================================

  async resetPassword(
    resetSessionToken: string,
    password: string,
    confirmPassword: string,
  ): Promise<ResetPasswordResult> {
    // --------------------------------------------------------
    // Validate input
    // --------------------------------------------------------

    this.validateResetSessionToken(resetSessionToken);

    this.validatePassword(password, confirmPassword);

    const resetSessionTokenHash = this.hashSessionToken(resetSessionToken);

    // --------------------------------------------------------
    // Load reset challenge
    // --------------------------------------------------------

    const challenge =
      await this.passwordResetRepository.findBySessionTokenHash(resetSessionTokenHash);

    if (!challenge) {
      throw new AppError(
        'INVALID_PASSWORD_RESET_SESSION',
        'Invalid or expired password reset session',
        400,
      );
    }

    // --------------------------------------------------------
    // OTP must already be verified
    // --------------------------------------------------------

    if (!challenge.verifiedAt) {
      throw new AppError(
        'PASSWORD_RESET_OTP_REQUIRED',
        'Password reset OTP must be verified first',
        400,
      );
    }

    // --------------------------------------------------------
    // Prevent reuse
    // --------------------------------------------------------

    if (challenge.consumedAt) {
      throw new AppError(
        'PASSWORD_RESET_SESSION_CONSUMED',
        'Password reset session has already been used',
        400,
      );
    }

    // --------------------------------------------------------
    // Check expiry
    // --------------------------------------------------------

    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        'PASSWORD_RESET_SESSION_EXPIRED',
        'Password reset session has expired',
        400,
      );
    }

    // --------------------------------------------------------
    // Resolve current credentials
    // --------------------------------------------------------

    const currentPasswordHash = await this.userCredentialsRepository.findPasswordHashByUserId(
      challenge.userId,
    );

    if (!currentPasswordHash) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account credentials are not available', 400);
    }

    // --------------------------------------------------------
    // Hash new password
    // --------------------------------------------------------

    const newPasswordHash = await hashPassword(password);

    // --------------------------------------------------------
    // Update password
    // --------------------------------------------------------

    await this.userCredentialsRepository.updatePasswordHash(challenge.userId, newPasswordHash);

    // --------------------------------------------------------
    // Revoke all refresh-token sessions
    //
    // This logs the user out from all existing devices/sessions.
    // --------------------------------------------------------

    await this.refreshTokenRepository.revokeAllForUser(challenge.userId);

    // --------------------------------------------------------
    // Consume reset session
    // --------------------------------------------------------

    const consumed = await this.passwordResetRepository.consume(resetSessionTokenHash);

    if (!consumed) {
      throw new AppError(
        'PASSWORD_RESET_SESSION_CONSUME_FAILED',
        'Password reset session could not be consumed',
        500,
      );
    }

    return {
      message: 'Password reset successfully',
    };
  }

  // ==========================================================
  // Hash Reset Session Token
  // ==========================================================

  private hashSessionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // ==========================================================
  // Validate Reset Session Token
  // ==========================================================

  private validateResetSessionToken(token: string): void {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
      throw new AppError('INVALID_PASSWORD_RESET_SESSION', 'Invalid password reset session', 400);
    }
  }

  // ==========================================================
  // Validate OTP
  // ==========================================================

  private validateOtp(otp: string): void {
    if (!/^\d{6}$/.test(otp)) {
      throw new AppError('INVALID_OTP', 'OTP must be 6 digits', 400);
    }
  }

  // ==========================================================
  // Validate Password
  // ==========================================================

  private validatePassword(password: string, confirmPassword: string): void {
    if (typeof password !== 'string') {
      throw new AppError('INVALID_PASSWORD', 'Password is required', 400);
    }

    if (password.length < 8) {
      throw new AppError('INVALID_PASSWORD', 'Password must be at least 8 characters', 400);
    }

    if (password.length > 128) {
      throw new AppError('INVALID_PASSWORD', 'Password must not exceed 128 characters', 400);
    }

    if (typeof confirmPassword !== 'string' || confirmPassword.length === 0) {
      throw new AppError('PASSWORD_MISMATCH', 'Please confirm your password', 400);
    }

    if (password !== confirmPassword) {
      throw new AppError('PASSWORD_MISMATCH', 'Passwords do not match', 400);
    }
  }

  // ==========================================================
  // Validate Challenge State
  // ==========================================================

  private ensureChallengeActive(challenge: PasswordResetChallenge): void {
    if (challenge.consumedAt) {
      throw new AppError(
        'PASSWORD_RESET_SESSION_CONSUMED',
        'Password reset session has already been used',
        400,
      );
    }

    if (challenge.verifiedAt) {
      throw new AppError(
        'PASSWORD_RESET_ALREADY_VERIFIED',
        'Password reset OTP has already been verified',
        409,
      );
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        'PASSWORD_RESET_SESSION_EXPIRED',
        'Password reset session has expired',
        400,
      );
    }
  }
}
