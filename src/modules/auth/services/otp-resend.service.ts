import { AppError } from '../../../common/errors/app-error.js';
import { decryptSecret } from '../../../common/crypto/encryption.js';

import type { OtpProvider } from '../providers/otp.provider.js';
import type { PendingSignupRepository } from '../repositories/pending-signup.repository.js';

export interface OtpResendResult {
  signupId: string;
  contactType: 'phone';
  expiresAt: Date;
}

const OTP_RESEND_COOLDOWN_SECONDS = 60;

export class OtpResendService {
  constructor(
    private readonly repository: PendingSignupRepository,
    private readonly otpProvider: OtpProvider,
  ) {}

  async resend(signupId: string): Promise<OtpResendResult> {
    // --------------------------------------------------------
    // Validate signup ID
    // --------------------------------------------------------

    if (!signupId) {
      throw new AppError('INVALID_SIGNUP', 'Invalid signup', 400);
    }

    // --------------------------------------------------------
    // Load pending signup
    //
    // This projection does not expose the provider
    // session token.
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
    // Signup OTP is phone-only
    // --------------------------------------------------------

    if (signup.contactType !== 'phone') {
      throw new AppError('INVALID_SIGNUP', 'Phone verification is required', 400);
    }

    // --------------------------------------------------------
    // Atomically claim resend slot
    //
    // Prevents concurrent resend requests from
    // both passing the cooldown check.
    // --------------------------------------------------------

    const providerSession = await this.repository.claimOtpResend(
      signupId,
      OTP_RESEND_COOLDOWN_SECONDS,
    );

    if (!providerSession) {
      throw new AppError('OTP_RESEND_TOO_SOON', 'Please wait before requesting another OTP', 429);
    }

    // --------------------------------------------------------
    // Decrypt provider credential
    //
    // The repository stores the session token encrypted.
    // Never send the encrypted value to Sendmator.
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
    // Ask Sendmator to resend using the existing
    // provider session.
    // --------------------------------------------------------

    const response = await this.otpProvider.resendSmsOtp(providerSessionToken);

    if (!response.expiresAt) {
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

    if (expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an expired session',
        502,
      );
    }

    // --------------------------------------------------------
    // Persist provider-reported expiry.
    // --------------------------------------------------------

    const updated = await this.repository.updateOtpProviderExpiry(signupId, expiresAt);

    if (!updated) {
      throw new AppError(
        'OTP_RESEND_UPDATE_FAILED',
        'Failed to update OTP verification session',
        500,
      );
    }

    return {
      signupId,
      contactType: 'phone',
      expiresAt,
    };
  }
}
