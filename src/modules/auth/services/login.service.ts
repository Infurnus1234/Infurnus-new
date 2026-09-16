import { AppError } from '../../../common/errors/app-error.js';
import { encryptSecret } from '../../../common/crypto/encryption.js';

import type { LoginRepository } from '../repositories/login.repository.js';
import type { LoginChallengeRepository } from '../repositories/login-challenge.repository.js';
import type { OtpProvider } from '../providers/otp.provider.js';

import { verifyPassword } from '../utils/password.js';

import { normalizeEmail, normalizePhone } from '../utils/contact.js';

import type { LoginInput } from '../types/login.js';

// ============================================================
// Login Challenge Result
// ============================================================

export interface LoginChallengeResult {
  challengeId: string;
  expiresAt: Date;
}

// ============================================================
// Validation Patterns
// ============================================================

const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================
// Login Service
// ============================================================

export class LoginService {
  constructor(
    private readonly repository: LoginRepository,
    private readonly loginChallengeRepository: LoginChallengeRepository,
    private readonly otpProvider: OtpProvider,
  ) {}

  // ==========================================================
  // Authenticate
  // ==========================================================

  async authenticate(input: LoginInput): Promise<LoginChallengeResult> {
    // --------------------------------------------------------
    // Determine supplied identifiers
    //
    // Allowed:
    //   email only
    //   phone only
    //   email + phone
    //
    // Not allowed:
    //   neither
    // --------------------------------------------------------

    const hasEmail = typeof input.email === 'string' && input.email.trim().length > 0;

    const hasPhone = typeof input.phone === 'string' && input.phone.trim().length > 0;

    if (!hasEmail && !hasPhone) {
      throw new AppError('INVALID_LOGIN', 'Either email or phone number is required', 400);
    }

    // --------------------------------------------------------
    // Normalize identifiers
    // --------------------------------------------------------

    const email = hasEmail ? normalizeEmail(input.email!) : null;

    const phone = hasPhone ? normalizePhone(input.phone!) : null;

    // --------------------------------------------------------
    // Validate email
    // --------------------------------------------------------

    if (email && !EMAIL_PATTERN.test(email)) {
      throw new AppError('INVALID_LOGIN', 'Invalid email address', 400);
    }

    // --------------------------------------------------------
    // Validate phone
    // --------------------------------------------------------

    if (phone && !PHONE_PATTERN.test(phone)) {
      throw new AppError('INVALID_LOGIN', 'Invalid phone number', 400);
    }

    // ========================================================
    // Find Login Identity
    // ========================================================

    let identity = null;

    // --------------------------------------------------------
    // Email supplied
    // --------------------------------------------------------

    if (email) {
      identity = await this.repository.findByEmail(email);

      // ------------------------------------------------------
      // If both email and phone are supplied, make sure they
      // belong to the same account.
      // ------------------------------------------------------

      if (identity && phone) {
        const phoneIdentity = await this.repository.findByPhone(phone);

        if (!phoneIdentity || phoneIdentity.id !== identity.id) {
          throw new AppError('INVALID_CREDENTIALS', 'Invalid email/phone or password', 401);
        }
      }
    }

    // --------------------------------------------------------
    // Phone only
    // --------------------------------------------------------

    if (!email) {
      identity = await this.repository.findByPhone(phone!);
    }

    // --------------------------------------------------------
    // User not found
    // --------------------------------------------------------

    if (!identity) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email/phone or password', 401);
    }

    // ========================================================
    // Account Status
    // ========================================================

    if (identity.status !== 'active') {
      throw new AppError('ACCOUNT_NOT_ACTIVE', 'Account is not active', 401);
    }

    // ========================================================
    // Password Verification
    // ========================================================

    const validPassword = await verifyPassword(identity.passwordHash, input.password);

    if (!validPassword) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email/phone or password', 401);
    }

    // ========================================================
    // Determine OTP Channel
    // ========================================================
    //
    // Phone supplied:
    //   SMS OTP
    //
    // Email only:
    //   Email OTP
    //
    // Both supplied:
    //   SMS OTP
    //
    // ========================================================

    const otpChannel = phone ? 'sms' : 'email';

    // ========================================================
    // Send OTP
    // ========================================================

    let providerSession: {
      sessionId: string;
      sessionToken: string;
      expiresAt: string;
    };

    if (otpChannel === 'sms') {
      // ------------------------------------------------------
      // SMS OTP
      // ------------------------------------------------------

      if (!identity.phone) {
        throw new AppError('PHONE_NOT_CONFIGURED', 'Account phone number is not configured', 500);
      }

      providerSession = await this.otpProvider.sendSmsOtp(identity.phone);
    } else {
      // ------------------------------------------------------
      // Email OTP
      // ------------------------------------------------------

      if (!identity.email) {
        throw new AppError('EMAIL_NOT_CONFIGURED', 'Account email address is not configured', 500);
      }

      providerSession = await this.otpProvider.sendEmailOtp(identity.email);
    }

    // ========================================================
    // Validate Provider Response
    // ========================================================

    if (
      typeof providerSession.sessionId !== 'string' ||
      providerSession.sessionId.length === 0 ||
      typeof providerSession.sessionToken !== 'string' ||
      providerSession.sessionToken.length === 0 ||
      typeof providerSession.expiresAt !== 'string' ||
      providerSession.expiresAt.length === 0
    ) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid session response',
        502,
      );
    }

    // ========================================================
    // Parse Provider Expiry
    // ========================================================

    const providerExpiresAt = new Date(providerSession.expiresAt);

    if (Number.isNaN(providerExpiresAt.getTime())) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid expiry time',
        502,
      );
    }

    // ========================================================
    // Ensure Provider Session Is Not Already Expired
    // ========================================================

    const now = Date.now();

    if (providerExpiresAt.getTime() <= now) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an expired session',
        502,
      );
    }

    // ========================================================
    // Encrypt Provider Session Token
    // ========================================================

    const encryptedProviderSessionToken = encryptSecret(providerSession.sessionToken);

    // --------------------------------------------------------
    // Local challenge cannot outlive provider session.
    // --------------------------------------------------------

    const expiresAt = providerExpiresAt;

    // ========================================================
    // Create Login Challenge
    // ========================================================

    const challenge = await this.loginChallengeRepository.create({
      userId: identity.id,

      otpProvider: 'sendmator',

      // IMPORTANT:
      // This was missing and caused your TS2345 error.
      otpChannel,

      providerSessionId: providerSession.sessionId,

      encryptedProviderSessionToken,

      providerExpiresAt,

      expiresAt,

      lastOtpSentAt: new Date(now),
    });

    // ========================================================
    // Verify Challenge Creation
    // ========================================================

    if (!challenge.id) {
      throw new AppError('LOGIN_CHALLENGE_CREATE_FAILED', 'Unable to create login challenge', 500);
    }

    // ========================================================
    // Return Challenge
    // ========================================================

    return {
      challengeId: challenge.id,
      expiresAt,
    };
  }
}
