import { AppError } from '../../../common/errors/app-error.js';
import { hashPassword } from '../utils/password.js';
import { generateOtp, hashOtp } from '../utils/otp.js';
import { normalizeEmail, normalizePhone } from '../utils/contact.js';

import type { OtpProvider } from '../providers/otp.provider.js';
import type { PendingSignupRepository } from '../repositories/pending-signup.repository.js';
import type { SignupUserRepository } from '../repositories/signup-user.repository.js';
import type { CreatePendingSignupData, SignupContactType } from '../types/signup.js';

const OTP_EXPIRY_MINUTES = 10;

export interface SignupInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  password: string;
  role: 'customer' | 'driver';
}

export interface SignupResult {
  signupId: string;
  contactType: SignupContactType;
  expiresAt: Date;
}

export class SignupService {
  constructor(
    private readonly repository: PendingSignupRepository,
    private readonly otpProvider: OtpProvider,
    private readonly userRepository: SignupUserRepository,
  ) {}

  async signup(input: SignupInput): Promise<SignupResult> {
    const hasEmail = Boolean(input.email);
    const hasPhone = Boolean(input.phone);

    if (hasEmail === hasPhone) {
      throw new AppError('INVALID_SIGNUP_CONTACT', 'Provide either email or phone number', 400);
    }

    const contactType: SignupContactType = hasEmail ? 'email' : 'phone';

    const rawContactValue = (hasEmail ? input.email : input.phone)!.trim();

    const contactValue =
      contactType === 'email' ? normalizeEmail(rawContactValue) : normalizePhone(rawContactValue);

    if (!contactValue) {
      throw new AppError('INVALID_SIGNUP_CONTACT', 'Invalid email or phone number', 400);
    }

    // Check whether a verified/non-deleted account
    // already exists for this normalized contact.
    const existingUser =
      contactType === 'email'
        ? await this.userRepository.existsByEmail(contactValue)
        : await this.userRepository.existsByPhone(contactValue);

    if (existingUser) {
      throw new AppError(
        'ACCOUNT_ALREADY_EXISTS',
        'An account already exists for this contact',
        409,
      );
    }

    // Check whether another signup is already waiting
    // for OTP verification.
    const existingPendingSignup = await this.repository.findByContact(contactType, contactValue);

    if (existingPendingSignup) {
      throw new AppError(
        'SIGNUP_ALREADY_PENDING',
        'A signup is already pending for this contact',
        409,
      );
    }

    const passwordHash = await hashPassword(input.password);

    const otp = generateOtp();
    const otpHash = hashOtp(otp);

    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    const data: CreatePendingSignupData = {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      contactType,
      contactValue,
      passwordHash,
      role: input.role,
      otpHash,
      otpExpiresAt,
    };

    const pendingSignup = await this.repository.create(data);

    if (contactType === 'email') {
      await this.otpProvider.sendEmailOtp(contactValue, otp);
    } else {
      await this.otpProvider.sendSmsOtp(contactValue, otp);
    }

    return {
      signupId: pendingSignup.id,
      contactType,
      expiresAt: otpExpiresAt,
    };
  }
}
