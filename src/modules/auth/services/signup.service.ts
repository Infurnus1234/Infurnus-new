import { AppError } from '../../../common/errors/app-error.js';

import { encryptSecret } from '../../../common/crypto/encryption.js';

import { hashPassword } from '../utils/password.js';

import { normalizeEmail, normalizePhone } from '../utils/contact.js';

import type { OtpProvider } from '../providers/otp.provider.js';

import type { PendingSignupRepository } from '../repositories/pending-signup.repository.js';

import type { SignupUserRepository } from '../repositories/signup-user.repository.js';

import type {
  CreatePendingSignupData,
  PublicSignupRole,
  SignupContactType,
} from '../types/signup.js';

// ============================================================
// Input / Result Types
// ============================================================

export interface SignupInput {
  firstName: string;
  lastName: string;

  email?: string;
  phone?: string;

  password: string;

  role: PublicSignupRole;

  /**
   * Required for:
   *   - driver
   *   - driver_fleet_owner
   */
  licenseNumber?: string;

  /**
   * Required for:
   *   - driver
   *   - driver_fleet_owner
   *
   * Format:
   *   YYYY-MM-DD
   */
  licenseExpiry?: string;

  /**
   * Required for:
   *   - fleet_owner
   *   - driver_fleet_owner
   */
  businessName?: string;
}

export interface SignupResult {
  signupId: string;
  contactType: SignupContactType;
  expiresAt: Date;
}

// ============================================================
// Validation Patterns
// ============================================================

const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
    // ========================================================
    // Validate provider-specific registration fields
    // ========================================================

    const isDriver = input.role === 'driver' || input.role === 'driver_fleet_owner';

    const isFleetOwner = input.role === 'fleet_owner' || input.role === 'driver_fleet_owner';

    // --------------------------------------------------------
    // Driver fields
    // --------------------------------------------------------

    let licenseNumber: string | null = null;
    let licenseExpiry: Date | null = null;

    if (isDriver) {
      if (typeof input.licenseNumber !== 'string' || input.licenseNumber.trim().length === 0) {
        throw new AppError(
          'INVALID_SIGNUP_DATA',
          'License number is required for driver registration',
          400,
        );
      }

      const normalizedLicenseNumber = input.licenseNumber.trim();

      if (normalizedLicenseNumber.length > 50) {
        throw new AppError(
          'INVALID_SIGNUP_DATA',
          'License number must not exceed 50 characters',
          400,
        );
      }

      if (
        typeof input.licenseExpiry !== 'string' ||
        !DATE_PATTERN.test(input.licenseExpiry.trim())
      ) {
        throw new AppError(
          'INVALID_SIGNUP_DATA',
          'License expiry must be in YYYY-MM-DD format',
          400,
        );
      }

      const parsedLicenseExpiry = new Date(`${input.licenseExpiry.trim()}T00:00:00.000Z`);

      if (Number.isNaN(parsedLicenseExpiry.getTime())) {
        throw new AppError('INVALID_SIGNUP_DATA', 'Invalid license expiry date', 400);
      }

      licenseNumber = normalizedLicenseNumber;
      licenseExpiry = parsedLicenseExpiry;
    }

    // --------------------------------------------------------
    // Fleet owner fields
    // --------------------------------------------------------

    let businessName: string | null = null;

    if (isFleetOwner) {
      if (typeof input.businessName !== 'string' || input.businessName.trim().length === 0) {
        throw new AppError(
          'INVALID_SIGNUP_DATA',
          'Business name is required for fleet owner registration',
          400,
        );
      }

      const normalizedBusinessName = input.businessName.trim();

      if (normalizedBusinessName.length > 150) {
        throw new AppError(
          'INVALID_SIGNUP_DATA',
          'Business name must not exceed 150 characters',
          400,
        );
      }

      businessName = normalizedBusinessName;
    }

    // ========================================================
    // Determine supplied contacts
    //
    // Allowed:
    //   email only
    //   phone only
    //   email + phone
    //
    // Not allowed:
    //   neither
    // ========================================================

    const hasEmail = typeof input.email === 'string' && input.email.trim().length > 0;

    const hasPhone = typeof input.phone === 'string' && input.phone.trim().length > 0;

    if (!hasEmail && !hasPhone) {
      throw new AppError('INVALID_SIGNUP_CONTACT', 'Either email or phone number is required', 400);
    }

    // ========================================================
    // Normalize email
    // ========================================================

    let email: string | null = null;

    if (hasEmail) {
      email = normalizeEmail(input.email!);

      if (!email || !EMAIL_PATTERN.test(email)) {
        throw new AppError('INVALID_SIGNUP_CONTACT', 'Invalid email address', 400);
      }
    }

    // ========================================================
    // Normalize phone
    // ========================================================

    let phone: string | null = null;

    if (hasPhone) {
      phone = normalizePhone(input.phone!);

      if (!phone || !PHONE_PATTERN.test(phone)) {
        throw new AppError('INVALID_SIGNUP_CONTACT', 'Invalid phone number', 400);
      }
    }

    // ========================================================
    // Determine primary OTP contact
    //
    // Phone supplied → SMS OTP
    // Otherwise      → Email OTP
    //
    // If both are supplied, phone is the OTP contact.
    // ========================================================

    const contactType: SignupContactType = phone ? 'phone' : 'email';

    const contactValue = phone ?? email!;

    // ========================================================
    // Check whether an account already exists
    //
    // Only existence is fetched.
    // No passwordHash or unrelated fields are loaded.
    // ========================================================

    const [existingPhone, existingEmail] = await Promise.all([
      phone ? this.userRepository.existsByPhone(phone) : Promise.resolve(false),

      email ? this.userRepository.existsByEmail(email) : Promise.resolve(false),
    ]);

    // --------------------------------------------------------
    // Existing phone account
    // --------------------------------------------------------

    if (existingPhone) {
      throw new AppError(
        'ACCOUNT_ALREADY_EXISTS',
        'An account already exists for this phone number',
        409,
      );
    }

    // --------------------------------------------------------
    // Existing email account
    // --------------------------------------------------------

    if (existingEmail) {
      throw new AppError(
        'ACCOUNT_ALREADY_EXISTS',
        'An account already exists for this email address',
        409,
      );
    }

    // ========================================================
    // Prevent duplicate pending signup
    // ========================================================

    const existingPendingSignup = await this.repository.findByContact(contactType, contactValue);

    if (existingPendingSignup) {
      throw new AppError(
        'SIGNUP_ALREADY_PENDING',
        `A signup is already pending for this ${contactType}`,
        409,
      );
    }

    // ========================================================
    // Hash password before persistence
    // ========================================================

    const passwordHash = await hashPassword(input.password);

    // ========================================================
    // Request provider-managed OTP
    //
    // Sendmator generates and delivers the OTP.
    // INFURNUS does not generate or hash the OTP.
    // ========================================================

    let providerSession: {
      provider?: string;
      sessionId: string;
      sessionToken: string;
      expiresAt: string;
    };

    if (contactType === 'phone') {
      // ------------------------------------------------------
      // Phone signup → SMS OTP
      // ------------------------------------------------------

      providerSession = await this.otpProvider.sendSmsOtp(phone!);
    } else {
      // ------------------------------------------------------
      // Email signup → Email OTP
      // ------------------------------------------------------

      providerSession = await this.otpProvider.sendEmailOtp(email!);
    }

    // ========================================================
    // Validate provider response
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
        'OTP provider returned an invalid session',
        502,
      );
    }

    // ========================================================
    // Validate provider expiry
    // ========================================================

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

    // ========================================================
    // Encrypt provider session token
    //
    // The provider session token is credential material.
    // It must never be persisted as plaintext.
    // ========================================================

    const encryptedProviderSessionToken = encryptSecret(providerSession.sessionToken);

    // ========================================================
    // Create provider-managed pending signup
    //
    // contactType/contactValue determine the OTP channel.
    //
    // No local OTP hash is generated or persisted.
    // ========================================================

    const data: CreatePendingSignupData = {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),

      email,

      contactType,
      contactValue,

      passwordHash,

      role: input.role,

      licenseNumber,
      licenseExpiry,

      businessName,

      otpProvider: providerSession.provider ?? 'external',
      otpProviderSessionId: providerSession.sessionId,
      otpProviderSessionToken: encryptedProviderSessionToken,
      otpProviderExpiresAt,
    };

    const pendingSignup = await this.repository.create(data);

    // ========================================================
    // Return safe signup state
    //
    // OTP and provider credentials are never returned.
    // ========================================================

    return {
      signupId: pendingSignup.id,
      contactType,
      expiresAt: otpProviderExpiresAt,
    };
  }
}
