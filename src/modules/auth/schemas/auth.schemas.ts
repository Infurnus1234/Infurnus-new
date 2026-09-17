import { z } from 'zod';

// ============================================================
// Common schemas
// ============================================================

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Invalid phone number');

const emailSchema = z
  .string()
  .trim()
  .email('Invalid email address')
  .max(320, 'Email must not exceed 320 characters');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must not exceed 128 characters');

// ============================================================
// Signup
// ============================================================
//
// Supported:
//
// 1. Email only
// 2. Phone only
// 3. Email + phone
//
// At least one contact method is required.
//
// If both are supplied, the service decides which
// contact receives the OTP.
// ============================================================

export const signupSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, 'First name is required')
      .max(100, 'First name must not exceed 100 characters'),

    lastName: z
      .string()
      .trim()
      .min(1, 'Last name is required')
      .max(100, 'Last name must not exceed 100 characters'),

    email: emailSchema.optional(),

    phone: phoneSchema.optional(),

    password: passwordSchema,

    confirmPassword: z.string().min(1, 'Please confirm your password'),

    role: z.enum(['customer', 'driver']).default('customer'),
  })
  .strict()
  .superRefine((data, ctx) => {
    // At least one contact method is required.
    if (!data.email && !data.phone) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Either email or phone number is required',
      });

      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'Either email or phone number is required',
      });
    }

    // Password confirmation.
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match',
      });
    }
  });

// ============================================================
// Signup OTP verification
// ============================================================

export const verifySignupOtpSchema = z
  .object({
    signupId: z.string().uuid('Invalid signup ID'),

    otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  })
  .strict();

// ============================================================
// Signup OTP resend
// ============================================================

export const resendSignupOtpSchema = z
  .object({
    signupId: z.string().uuid('Invalid signup ID'),
  })
  .strict();

// ============================================================
// Login
// ============================================================
//
// Supported:
//
// 1. Email + password
// 2. Phone + password
// 3. Email + phone + password
//
// At least one identifier is required.
//
// OTP channel:
//
// - Phone supplied -> SMS OTP
// - Email only -> Email OTP
// - Both supplied -> Phone/SMS preferred
// ============================================================

export const loginSchema = z
  .object({
    email: emailSchema.optional(),

    phone: phoneSchema.optional(),

    password: z
      .string()
      .min(1, 'Password is required')
      .max(128, 'Password must not exceed 128 characters'),
  })
  .strict()
  .superRefine((data, ctx) => {
    // At least one login identifier is required.
    if (!data.email && !data.phone) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Either email or phone number is required',
      });

      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'Either email or phone number is required',
      });
    }
  });

// ============================================================
// Login OTP verification
// ============================================================

export const verifyLoginOtpSchema = z
  .object({
    challengeId: z.string().uuid('Invalid login challenge ID'),

    otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  })
  .strict();

// ============================================================
// Login OTP resend
// ============================================================

export const resendLoginOtpSchema = z
  .object({
    challengeId: z.string().uuid('Invalid login challenge ID'),
  })
  .strict();
