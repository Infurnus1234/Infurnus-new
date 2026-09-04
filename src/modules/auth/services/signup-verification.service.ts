import { AppError } from '../../../common/errors/app-error.js';
import type { SignupCompletionRepository } from '../repositories/signup-completion.repository.js';
import { hashOtp } from '../utils/otp.js';

export interface SignupVerificationResult {
  userId: string;
  role: string;
  status: string;
}

export class SignupVerificationService {
  constructor(private readonly repository: SignupCompletionRepository) {}

  async verify(signupId: string, otp: string): Promise<SignupVerificationResult> {
    if (!signupId) {
      throw new AppError('INVALID_SIGNUP', 'Invalid signup', 400);
    }

    if (!/^\d{6}$/.test(otp)) {
      throw new AppError('INVALID_OTP', 'OTP must be 6 digits', 400);
    }

    const otpHash = hashOtp(otp);

    const result = await this.repository.verifyAndComplete(signupId, otpHash);

    switch (result.status) {
      case 'not_found':
        throw new AppError('INVALID_SIGNUP', 'Invalid or expired signup', 400);

      case 'already_verified':
        throw new AppError('OTP_ALREADY_VERIFIED', 'OTP has already been verified', 400);

      case 'expired':
        throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);

      case 'attempts_exceeded':
        throw new AppError('OTP_ATTEMPTS_EXCEEDED', 'Maximum OTP attempts exceeded', 429);

      case 'invalid_otp':
        throw new AppError('INVALID_OTP', 'Invalid OTP', 400);

      case 'completed':
        return {
          userId: result.user.id,
          role: result.user.role,
          status: result.user.status,
        };
    }
  }
}
