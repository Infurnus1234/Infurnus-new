import { AppError } from '../../../common/errors/app-error.js';

import { generateOtp, hashOtp } from '../utils/otp.js';

import type { OtpProvider } from '../providers/otp.provider.js';
import type { PendingSignupRepository } from '../repositories/pending-signup.repository.js';

// ============================================================
// Configuration
// ============================================================

const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

// ============================================================
// Input / Result types
// ============================================================

export interface ResendOtpInput {
  signupId: string;
}

export interface ResendOtpResult {
  signupId: string;
  contactType: 'email' | 'phone';
  expiresAt: Date;
}

// ============================================================
// OTP Resend Service
// ============================================================

export class OtpResendService {
  constructor(
    private readonly repository: PendingSignupRepository,
    private readonly otpProvider: OtpProvider,
  ) {}

  async resend(input: ResendOtpInput): Promise<ResendOtpResult> {
    // --------------------------------------------------------
    // Validate signup ID
    // --------------------------------------------------------

    if (!input.signupId) {
      throw new AppError('INVALID_SIGNUP', 'Invalid signup ID', 400);
    }

    // --------------------------------------------------------
    // Find pending signup
    //
    // We need the contact information for OTP delivery and
    // to distinguish invalid/verified signup from cooldown.
    // --------------------------------------------------------

    const signup = await this.repository.findById(input.signupId);

    if (!signup) {
      throw new AppError('INVALID_SIGNUP', 'Signup not found', 400);
    }

    // --------------------------------------------------------
    // Prevent resend after successful verification
    // --------------------------------------------------------

    if (signup.otpVerifiedAt) {
      throw new AppError('OTP_ALREADY_VERIFIED', 'Signup OTP has already been verified', 400);
    }

    // --------------------------------------------------------
    // Generate new OTP
    // --------------------------------------------------------

    const otp = generateOtp();
    const otpHash = hashOtp(otp);

    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // --------------------------------------------------------
    // Atomically enforce cooldown + replace OTP
    //
    // The database performs the cooldown check and update
    // as one atomic operation.
    //
    // This prevents two concurrent resend requests from
    // both passing the cooldown check.
    // --------------------------------------------------------

    const updated = await this.repository.resendOtpIfCooldownElapsed(
      signup.id,
      otpHash,
      expiresAt,
      OTP_RESEND_COOLDOWN_SECONDS,
    );

    if (!updated) {
      // ------------------------------------------------------
      // The signup still exists, so the failed update means
      // the cooldown was won by another concurrent request.
      // ------------------------------------------------------

      throw new AppError('OTP_RESEND_TOO_SOON', 'Please wait before requesting another OTP', 429);
    }

    // --------------------------------------------------------
    // Deliver OTP
    //
    // The OTP is never returned in the API response
    // and must never be logged.
    // --------------------------------------------------------

    if (signup.contactType === 'email') {
      await this.otpProvider.sendEmailOtp(signup.contactValue, otp);
    } else {
      await this.otpProvider.sendSmsOtp(signup.contactValue, otp);
    }

    // --------------------------------------------------------
    // Return safe response
    // --------------------------------------------------------

    return {
      signupId: signup.id,
      contactType: signup.contactType,
      expiresAt,
    };
  }
}
