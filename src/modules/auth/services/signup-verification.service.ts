import { AppError } from '../../../common/errors/app-error.js';
import { decryptSecret } from '../../../common/crypto/encryption.js';

import type { OtpProvider } from '../providers/otp.provider.js';
import type { PendingSignupRepository } from '../repositories/pending-signup.repository.js';
import type { SignupCompletionRepository } from '../repositories/signup-completion.repository.js';

export interface SignupVerificationResult {
  userId: string;
  role: string;
  status: string;
}

export class SignupVerificationService {
  constructor(
    private readonly pendingSignupRepository: PendingSignupRepository,
    private readonly completionRepository: SignupCompletionRepository,
    private readonly otpProvider: OtpProvider,
  ) {}

  async verify(signupId: string, otp: string): Promise<SignupVerificationResult> {
    // --------------------------------------------------------
    // Validate input
    // --------------------------------------------------------

    if (!signupId) {
      throw new AppError('INVALID_SIGNUP', 'Invalid signup', 400);
    }

    if (!/^\d{6}$/.test(otp)) {
      throw new AppError('INVALID_OTP', 'OTP must be 6 digits', 400);
    }

    // --------------------------------------------------------
    // Load provider session
    // --------------------------------------------------------

    const providerSession = await this.pendingSignupRepository.getOtpProviderSession(signupId);

    if (!providerSession) {
      throw new AppError('INVALID_SIGNUP', 'Invalid or expired signup', 400);
    }

    // --------------------------------------------------------
    // Provider session expiry
    // --------------------------------------------------------

    if (providerSession.expiresAt.getTime() <= Date.now()) {
      throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);
    }

    // --------------------------------------------------------
    // Prevent replay
    // --------------------------------------------------------

    if (providerSession.verifiedAt) {
      throw new AppError('OTP_ALREADY_VERIFIED', 'OTP has already been verified', 400);
    }

    // --------------------------------------------------------
    // Decrypt provider session token
    // --------------------------------------------------------

    let providerSessionToken: string;

    try {
      providerSessionToken = decryptSecret(providerSession.sessionToken);
    } catch {
      throw new AppError(
        'OTP_PROVIDER_SESSION_INVALID',
        'OTP verification session is invalid',
        500,
      );
    }

    // --------------------------------------------------------
    // Verify OTP with Sendmator
    //
    // INFURNUS does not verify a locally stored OTP hash.
    // --------------------------------------------------------

    const verification = await this.otpProvider.verifySmsOtp(providerSessionToken, otp);

    if (!verification.verified) {
      if (verification.attemptsRemaining <= 0) {
        throw new AppError('OTP_ATTEMPTS_EXCEEDED', 'Maximum OTP attempts exceeded', 429);
      }

      throw new AppError('INVALID_OTP', 'Invalid OTP', 400);
    }

    // --------------------------------------------------------
    // Atomically complete verified signup
    // --------------------------------------------------------

    const result = await this.completionRepository.completeVerifiedSignup(signupId);

    switch (result.status) {
      case 'not_found':
        throw new AppError('INVALID_SIGNUP', 'Invalid or expired signup', 400);

      case 'already_verified':
        throw new AppError('OTP_ALREADY_VERIFIED', 'OTP has already been verified', 400);

      case 'completed':
        return {
          userId: result.user.id,
          role: result.user.role,
          status: result.user.status,
        };
    }
  }
}
