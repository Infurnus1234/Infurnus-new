import { AppError } from '../../../common/errors/app-error.js';
import { encryptSecret } from '../../../common/crypto/encryption.js';

import { hashPassword } from '../utils/password.js';
import { normalizeEmail, normalizePhone } from '../utils/contact.js';

import type { OtpProvider } from '../providers/otp.provider.js';

import type { PendingSignupRepository } from '../repositories/pending-signup.repository.js';
import type { SignupUserRepository } from '../repositories/signup-user.repository.js';

import type { CreatePendingSignupData, SignupContactType } from '../types/signup.js';

// ============================================================
// Input / Result types
// ============================================================

export interface SignupInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  password: string;
  role: 'customer' | 'driver';
}

export interface SignupResult {
  signupId: string;
  contactType: SignupContactType;
  expiresAt: Date;
}

// ============================================================
// Signup Service
// ============================================================

export class SignupService {
  constructor(
    private readonly repository: PendingSignupRepository,
    private readonly otpProvider: OtpProvider,
    private readonly userRepository: SignupUserRepository,
  ) {}

  // ==========================================================
  // Signup
  // ==========================================================

  async signup(input: SignupInput): Promise<SignupResult> {
    // --------------------------------------------------------
    // Validate mandatory phone number
    // --------------------------------------------------------

    if (!input.phone || !input.phone.trim()) {
      throw new AppError('INVALID_SIGNUP_CONTACT', 'Phone number is required', 400);
    }

    const phone = normalizePhone(input.phone.trim());

    if (!phone) {
      throw new AppError('INVALID_SIGNUP_CONTACT', 'Invalid phone number', 400);
    }

    // --------------------------------------------------------
    // Normalize optional email
    // --------------------------------------------------------

    let email: string | null = null;

    if (input.email !== undefined && input.email.trim() !== '') {
      email = normalizeEmail(input.email.trim());

      if (!email) {
        throw new AppError('INVALID_SIGNUP_CONTACT', 'Invalid email address', 400);
      }
    }

    // --------------------------------------------------------
    // Check whether an account already exists
    //
    // Only existence is fetched.
    // No passwordHash or unrelated fields are loaded.
    // --------------------------------------------------------

    const [existingPhone, existingEmail] = await Promise.all([
      this.userRepository.existsByPhone(phone),

      email ? this.userRepository.existsByEmail(email) : Promise.resolve(false),
    ]);

    if (existingPhone) {
      throw new AppError(
        'ACCOUNT_ALREADY_EXISTS',
        'An account already exists for this phone number',
        409,
      );
    }

    if (existingEmail) {
      throw new AppError(
        'ACCOUNT_ALREADY_EXISTS',
        'An account already exists for this email address',
        409,
      );
    }

    // --------------------------------------------------------
    // Prevent duplicate pending signup
    // --------------------------------------------------------

    const existingPendingSignup = await this.repository.findByContact('phone', phone);

    if (existingPendingSignup) {
      throw new AppError(
        'SIGNUP_ALREADY_PENDING',
        'A signup is already pending for this phone number',
        409,
      );
    }

    // --------------------------------------------------------
    // Hash password before persistence
    // --------------------------------------------------------

    const passwordHash = await hashPassword(input.password);

    // --------------------------------------------------------
    // Request provider-managed OTP
    //
    // Sendmator generates and delivers the OTP.
    // INFURNUS does not generate or hash the OTP.
    // --------------------------------------------------------

    const providerSession = await this.otpProvider.sendSmsOtp(phone);

    if (!providerSession.sessionId || !providerSession.sessionToken || !providerSession.expiresAt) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid session',
        502,
      );
    }

    // --------------------------------------------------------
    // Validate provider expiry
    // --------------------------------------------------------

    const otpProviderExpiresAt = new Date(providerSession.expiresAt);

    if (Number.isNaN(otpProviderExpiresAt.getTime())) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an invalid expiry time',
        502,
      );
    }

    if (otpProviderExpiresAt.getTime() <= Date.now()) {
      throw new AppError(
        'OTP_PROVIDER_INVALID_RESPONSE',
        'OTP provider returned an expired session',
        502,
      );
    }

    // --------------------------------------------------------
    // Encrypt provider session token
    //
    // The provider session token is credential material.
    // It must never be persisted as plaintext.
    // --------------------------------------------------------

    const encryptedProviderSessionToken = encryptSecret(providerSession.sessionToken);

    // --------------------------------------------------------
    // Create provider-managed pending signup
    //
    // Phone is always the primary contact.
    // Email is optional.
    //
    // No local OTP hash is generated or persisted.
    // --------------------------------------------------------

    const data: CreatePendingSignupData = {
      firstName: input.firstName.trim(),

      lastName: input.lastName.trim(),

      email,

      contactType: 'phone',

      contactValue: phone,

      passwordHash,

      role: input.role,

      otpProvider: 'sendmator',

      otpProviderSessionId: providerSession.sessionId,

      otpProviderSessionToken: encryptedProviderSessionToken,

      otpProviderExpiresAt,
    };

    const pendingSignup = await this.repository.create(data);

    // --------------------------------------------------------
    // Return only safe signup state
    //
    // OTP and provider credentials are never returned.
    // --------------------------------------------------------

    return {
      signupId: pendingSignup.id,

      contactType: 'phone',

      expiresAt: otpProviderExpiresAt,
    };
  }
}
