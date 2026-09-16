import { AppError } from '../../../common/errors/app-error.js';
import { decryptSecret } from '../../../common/crypto/encryption.js';

import type { AuthUserRepository } from '../repositories/auth-user.repository.js';
import type { LoginChallengeRepository } from '../repositories/login-challenge.repository.js';
import type { OtpProvider } from '../providers/otp.provider.js';
import type { LoginOtpChannel } from '../types/login-challenge.js';

// ============================================================
// Login Verification Result
// ============================================================

export interface LoginVerificationResult {
  userId: string;
  role: string;
}

// ============================================================
// Login Verification Service
// ============================================================

export class LoginVerificationService {
  constructor(
    private readonly loginChallengeRepository: LoginChallengeRepository,
    private readonly authUserRepository: AuthUserRepository,
    private readonly otpProvider: OtpProvider,
  ) {}

  // ==========================================================
  // Verify Login OTP
  // ==========================================================

  async verify(challengeId: string, otp: string): Promise<LoginVerificationResult> {
    // --------------------------------------------------------
    // Validate challenge ID
    // --------------------------------------------------------

    if (typeof challengeId !== 'string' || challengeId.trim().length === 0) {
      throw new AppError('INVALID_LOGIN_CHALLENGE', 'Invalid login challenge', 400);
    }

    // --------------------------------------------------------
    // Validate OTP
    // --------------------------------------------------------

    if (!/^\d{6}$/.test(otp)) {
      throw new AppError('INVALID_OTP', 'OTP must be 6 digits', 400);
    }

    // --------------------------------------------------------
    // Load provider session
    // --------------------------------------------------------

    const providerSession = await this.loginChallengeRepository.getProviderSession(challengeId);

    if (!providerSession) {
      throw new AppError('INVALID_LOGIN_CHALLENGE', 'Invalid or expired login challenge', 400);
    }

    // --------------------------------------------------------
    // Challenge already consumed
    // --------------------------------------------------------

    if (providerSession.consumedAt) {
      throw new AppError(
        'LOGIN_CHALLENGE_ALREADY_CONSUMED',
        'Login challenge has already been consumed',
        400,
      );
    }

    // --------------------------------------------------------
    // Challenge already verified
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

    if (providerSession.providerExpiresAt && providerSession.providerExpiresAt.getTime() <= now) {
      throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);
    }

    // --------------------------------------------------------
    // Validate OTP channel
    // --------------------------------------------------------

    const otpChannel: LoginOtpChannel = providerSession.otpChannel;

    if (otpChannel !== 'sms' && otpChannel !== 'email') {
      throw new AppError('LOGIN_VERIFICATION_FAILED', 'Invalid OTP verification channel', 500);
    }

    // --------------------------------------------------------
    // Decrypt provider session token
    //
    // The raw provider session token is encrypted at rest.
    // --------------------------------------------------------

    let providerSessionToken: string;

    try {
      providerSessionToken = decryptSecret(providerSession.encryptedProviderSessionToken);
    } catch {
      throw new AppError(
        'OTP_PROVIDER_SESSION_INVALID',
        'OTP verification session is invalid',
        500,
      );
    }

    // ========================================================
    // Verify OTP with correct provider channel
    // ========================================================

    let verification: {
      verified: boolean;
      attemptsRemaining: number;
    };

    try {
      if (otpChannel === 'email') {
        verification = await this.otpProvider.verifyEmailOtp(providerSessionToken, otp);
      } else {
        verification = await this.otpProvider.verifySmsOtp(providerSessionToken, otp);
      }
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
        throw new AppError('OTP_ATTEMPTS_EXCEEDED', 'Maximum OTP attempts exceeded', 429);
      }

      throw new AppError('INVALID_OTP', 'Invalid OTP', 400);
    }

    // ========================================================
    // Atomically consume login challenge
    // ========================================================
    //
    // Only one concurrent verification request can successfully
    // consume the same challenge.
    //
    // ========================================================

    const consumed = await this.loginChallengeRepository.consume(challengeId);

    switch (consumed.status) {
      case 'not_found':
        throw new AppError('INVALID_LOGIN_CHALLENGE', 'Invalid or expired login challenge', 400);

      case 'already_consumed':
        throw new AppError(
          'LOGIN_CHALLENGE_ALREADY_CONSUMED',
          'Login challenge has already been consumed',
          400,
        );

      case 'expired':
        throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);

      case 'consumed':
        break;
    }

    // --------------------------------------------------------
    // Verify consumed user
    // --------------------------------------------------------

    if (!consumed.userId) {
      throw new AppError('LOGIN_VERIFICATION_FAILED', 'Login verification failed', 500);
    }

    // ========================================================
    // Resolve current identity
    // ========================================================
    //
    // Always resolve the current account from the database after
    // successful OTP verification.
    //
    // This prevents stale challenge data from becoming the
    // authorization source.
    //
    // ========================================================

    const identity = await this.authUserRepository.findIdentityById(consumed.userId);

    if (!identity) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account is not available', 401);
    }

    // --------------------------------------------------------
    // Account must still be active
    // --------------------------------------------------------

    if (identity.status !== 'active') {
      throw new AppError('ACCOUNT_NOT_ACTIVE', 'Account is not active', 401);
    }

    // --------------------------------------------------------
    // Return current identity
    // --------------------------------------------------------

    return {
      userId: identity.id,
      role: identity.role,
    };
  }
}
