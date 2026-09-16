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

  async resend(challengeId: string): Promise<LoginResendResult> {
    // --------------------------------------------------------
    // Validate challenge ID
    // --------------------------------------------------------

    if (typeof challengeId !== 'string' || challengeId.trim().length === 0) {
      throw new AppError('INVALID_LOGIN_CHALLENGE', 'Invalid login challenge', 400);
    }

    // --------------------------------------------------------
    // Validate resend configuration
    // --------------------------------------------------------

    if (!Number.isFinite(this.cooldownSeconds) || this.cooldownSeconds < 0) {
      throw new AppError('INVALID_CONFIGURATION', 'Invalid OTP resend configuration', 500);
    }

    // --------------------------------------------------------
    // Load provider session
    // --------------------------------------------------------

    const providerSession = await this.loginChallengeRepository.getProviderSession(challengeId);

    if (!providerSession) {
      throw new AppError('INVALID_LOGIN_CHALLENGE', 'Invalid or expired login challenge', 400);
    }

    // --------------------------------------------------------
    // Prevent resend after challenge consumption
    // --------------------------------------------------------

    if (providerSession.consumedAt) {
      throw new AppError(
        'LOGIN_CHALLENGE_ALREADY_CONSUMED',
        'Login challenge has already been consumed',
        400,
      );
    }

    // --------------------------------------------------------
    // Prevent resend after verification
    // --------------------------------------------------------

    if (providerSession.verifiedAt) {
      throw new AppError(
        'LOGIN_CHALLENGE_ALREADY_VERIFIED',
        'Login challenge has already been verified',
        400,
      );
    }

    // --------------------------------------------------------
    // Check local challenge expiry
    // --------------------------------------------------------

    const now = Date.now();

    if (providerSession.expiresAt.getTime() <= now) {
      throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);
    }

    // --------------------------------------------------------
    // Check provider session expiry
    // --------------------------------------------------------

    if (providerSession.providerExpiresAt.getTime() <= now) {
      throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);
    }

    // --------------------------------------------------------
    // Validate OTP channel
    // --------------------------------------------------------

    if (providerSession.otpChannel !== 'sms' && providerSession.otpChannel !== 'email') {
      throw new AppError('LOGIN_RESEND_FAILED', 'Invalid OTP resend channel', 500);
    }

    /*
     * Atomically claim the resend slot.
     *
     * The database operation prevents concurrent requests from
     * obtaining the same resend slot.
     */
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

    // --------------------------------------------------------
    // Validate claimed channel
    // --------------------------------------------------------

    if (claim.otpChannel !== 'sms' && claim.otpChannel !== 'email') {
      throw new AppError('LOGIN_RESEND_FAILED', 'Invalid OTP resend channel', 500);
    }

    // --------------------------------------------------------
    // Decrypt provider session token
    // --------------------------------------------------------

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

    if (providerSessionToken.length === 0) {
      throw new AppError(
        'OTP_PROVIDER_SESSION_INVALID',
        'OTP verification session is invalid',
        500,
      );
    }

    // ========================================================
    // Resend through the correct OTP channel
    // ========================================================

    let resendResult: {
      expiresAt: string;
    };

    try {
      if (claim.otpChannel === 'email') {
        // ----------------------------------------------------
        // Email login → Email OTP resend
        // ----------------------------------------------------

        resendResult = await this.otpProvider.resendEmailOtp(providerSessionToken);
      } else {
        // ----------------------------------------------------
        // Phone login → SMS OTP resend
        // ----------------------------------------------------

        resendResult = await this.otpProvider.resendSmsOtp(providerSessionToken);
      }
    } catch {
      /*
       * Do not expose provider implementation details.
       *
       * The resend claim has already been atomically reserved.
       * Keeping that reservation prevents repeated provider calls
       * from concurrent/abusive requests.
       */
      throw new AppError(
        'OTP_PROVIDER_UNAVAILABLE',
        'OTP resend service is temporarily unavailable',
        502,
      );
    }

    // --------------------------------------------------------
    // Validate provider expiry
    // --------------------------------------------------------

    if (typeof resendResult.expiresAt !== 'string' || resendResult.expiresAt.length === 0) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid expiry time',
        502,
      );
    }

    const providerExpiresAt = new Date(resendResult.expiresAt);

    if (Number.isNaN(providerExpiresAt.getTime())) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid expiry time',
        502,
      );
    }

    // --------------------------------------------------------
    // Provider session must not already be expired
    // --------------------------------------------------------

    if (providerExpiresAt.getTime() <= Date.now()) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an expired session',
        502,
      );
    }

    /*
     * The repository implementation synchronizes the local
     * challenge expiry with the provider expiry.
     *
     * A successful provider resend therefore cannot leave the
     * challenge with an independently stale local expiry.
     */

    let updated = false;

    try {
      updated = await this.loginChallengeRepository.updateProviderExpiry(
        challengeId,
        providerExpiresAt,
      );
    } catch {
      /*
       * The provider has already accepted the resend.
       * Do not expose the underlying database error or
       * connection details.
       */
      throw new AppError(
        'LOGIN_RESEND_UPDATE_FAILED',
        'Failed to update login verification session',
        500,
      );
    }

    if (!updated) {
      /*
       * Provider resend succeeded, but the challenge could no
       * longer be updated locally. This is a consistency failure,
       * not a client validation error.
       */
      throw new AppError(
        'LOGIN_RESEND_UPDATE_FAILED',
        'Failed to update login verification session',
        500,
      );
    }

    // --------------------------------------------------------
    // Return updated expiry
    // --------------------------------------------------------

    return {
      expiresAt: providerExpiresAt,
    };
  }
}
