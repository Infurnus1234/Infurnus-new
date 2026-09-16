import { AppError } from '../../../common/errors/app-error.js';
import { decryptSecret } from '../../../common/crypto/encryption.js';

import { env } from '../../../config/env.js';

import type { OtpProvider } from '../providers/otp.provider.js';
import type { PendingSignupRepository } from '../repositories/pending-signup.repository.js';

// ============================================================
// OTP Resend Result
// ============================================================

export interface OtpResendResult {
  signupId: string;
  contactType: 'phone' | 'email';
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

  // ==========================================================
  // Resend OTP
  // ==========================================================

  async resend(signupId: string): Promise<OtpResendResult> {
    // --------------------------------------------------------
    // Validate signup ID
    // --------------------------------------------------------

    if (typeof signupId !== 'string' || signupId.trim().length === 0) {
      throw new AppError('INVALID_SIGNUP', 'Invalid signup', 400);
    }

    // --------------------------------------------------------
    // Load pending signup
    //
    // This projection does not expose the provider
    // session token directly.
    // --------------------------------------------------------

    const signup = await this.repository.findById(signupId);

    if (!signup) {
      throw new AppError('INVALID_SIGNUP', 'Invalid or expired signup', 400);
    }

    // --------------------------------------------------------
    // Prevent resend after verification
    // --------------------------------------------------------

    if (signup.otpVerifiedAt) {
      throw new AppError('OTP_ALREADY_VERIFIED', 'OTP has already been verified', 400);
    }

    // --------------------------------------------------------
    // Validate signup contact type
    // --------------------------------------------------------

    if (signup.contactType !== 'phone' && signup.contactType !== 'email') {
      throw new AppError('INVALID_SIGNUP', 'Invalid OTP verification contact', 400);
    }

    // --------------------------------------------------------
    // Atomically claim resend slot
    //
    // Cooldown is environment-configured.
    // --------------------------------------------------------

    const providerSession = await this.repository.claimOtpResend(
      signupId,
      env.AUTH_OTP_RESEND_COOLDOWN_SECONDS,
    );

    if (!providerSession) {
      throw new AppError('OTP_RESEND_TOO_SOON', 'Please wait before requesting another OTP', 429);
    }

    // --------------------------------------------------------
    // Decrypt provider session token
    //
    // The repository stores the provider session token
    // encrypted. Never send the encrypted value to Sendmator.
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

    // ========================================================
    // Resend using correct OTP channel
    // ========================================================

    let response: {
      expiresAt: string;
    };

    if (signup.contactType === 'email') {
      // ------------------------------------------------------
      // Email signup → Email OTP resend
      // ------------------------------------------------------

      response = await this.otpProvider.resendEmailOtp(providerSessionToken);
    } else {
      // ------------------------------------------------------
      // Phone signup → SMS OTP resend
      // ------------------------------------------------------

      response = await this.otpProvider.resendSmsOtp(providerSessionToken);
    }

    // --------------------------------------------------------
    // Validate provider expiry
    // --------------------------------------------------------

    if (typeof response.expiresAt !== 'string' || response.expiresAt.length === 0) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid expiry time',
        502,
      );
    }

    const expiresAt = new Date(response.expiresAt);

    if (Number.isNaN(expiresAt.getTime())) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid expiry time',
        502,
      );
    }

    // --------------------------------------------------------
    // Provider session must not already be expired
    // --------------------------------------------------------

    if (expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an expired session',
        502,
      );
    }

    // --------------------------------------------------------
    // Persist provider-reported expiry
    // --------------------------------------------------------

    const updated = await this.repository.updateOtpProviderExpiry(signupId, expiresAt);

    if (!updated) {
      throw new AppError(
        'OTP_RESEND_UPDATE_FAILED',
        'Failed to update OTP verification session',
        500,
      );
    }

    // --------------------------------------------------------
    // Return result
    // --------------------------------------------------------

    return {
      signupId,
      contactType: signup.contactType,
      expiresAt,
    };
  }
}
