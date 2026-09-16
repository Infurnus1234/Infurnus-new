import { AppError } from '../../../common/errors/app-error.js';
import { decryptSecret } from '../../../common/crypto/encryption.js';
import type { AuthUserRepository } from '../repositories/auth-user.repository.js';
import type { LoginChallengeRepository } from '../repositories/login-challenge.repository.js';
import type { OtpProvider } from '../providers/otp.provider.js';

export interface LoginVerificationResult {
  userId: string;
  role: string;
}

export class LoginVerificationService {
  constructor(
    private readonly loginChallengeRepository: LoginChallengeRepository,
    private readonly authUserRepository: AuthUserRepository,
    private readonly otpProvider: OtpProvider,
  ) {}

  async verify(challengeId: string, otp: string, _channel: 'phone' | 'email' = 'phone'): Promise<LoginVerificationResult> {
    if (!challengeId) {
      throw new AppError('INVALID_LOGIN_CHALLENGE', 'Invalid login challenge', 400);
    }

    if (!/^\d{6}$/.test(otp)) {
      throw new AppError('INVALID_OTP', 'OTP must be 6 digits', 400);
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

    const verification = await this.otpProvider.verifySmsOtp(providerSessionToken, otp);

    if (!verification.verified) {
      if (verification.attemptsRemaining <= 0) {
        throw new AppError('OTP_ATTEMPTS_EXCEEDED', 'Maximum OTP attempts exceeded', 429);
      }

      throw new AppError('INVALID_OTP', 'Invalid OTP', 400);
    }

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

    if (!consumed.userId || !consumed.role) {
      throw new AppError('LOGIN_VERIFICATION_FAILED', 'Login verification failed', 500);
    }

    const identity = await this.authUserRepository.findIdentityById(consumed.userId);

    if (!identity) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Account is not available', 401);
    }

    if (identity.status !== 'active') {
      throw new AppError('ACCOUNT_NOT_ACTIVE', 'Account is not active', 401);
    }

    return {
      userId: identity.id,
      role: identity.role,
    };
  }
}
