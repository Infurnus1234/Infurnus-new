import { AppError } from '../../../common/errors/app-error.js';
import type { PendingSignupRepository } from '../repositories/pending-signup.repository.js';
import { hashOtp } from '../utils/otp.js';
import type { PendingSignup } from '../types/signup.js';

const MAX_OTP_ATTEMPTS = 5;

export class OtpService {
  constructor(private readonly repository: PendingSignupRepository) {}

  async verify(signup: PendingSignup, otp: string): Promise<void> {
    if (signup.otpVerifiedAt) {
      throw new AppError('OTP_ALREADY_VERIFIED', 'OTP has already been verified', 400);
    }

    if (signup.otpExpiresAt.getTime() <= Date.now()) {
      throw new AppError('OTP_EXPIRED', 'OTP has expired', 400);
    }

    if (signup.otpAttempts >= MAX_OTP_ATTEMPTS) {
      throw new AppError('OTP_ATTEMPTS_EXCEEDED', 'Maximum OTP attempts exceeded', 429);
    }

    const providedOtpHash = hashOtp(otp);

    if (providedOtpHash !== signup.otpHash) {
      await this.repository.incrementOtpAttempts(signup.id);

      throw new AppError('INVALID_OTP', 'Invalid OTP', 400);
    }

    await this.repository.markOtpVerified(signup.id);
  }
}
