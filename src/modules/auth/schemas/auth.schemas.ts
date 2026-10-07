import { z } from 'zod';

// ============================================================
// Common schemas
// ============================================================

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Invalid phone number');

export const emailSchema = z
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
// Supported roles:
//
// 1. customer
// 2. driver
// 3. fleet_owner
// 4. driver_fleet_owner
//
// Contact:
//
// 1. Email only
// 2. Phone only
// 3. Email + phone
//
// At least one contact method is required.
//
// Role-specific fields:
//
// driver:
//   - licenseNumber
//   - licenseExpiry
//
// fleet_owner:
//   - businessName
//
// driver_fleet_owner:
//   - licenseNumber
//   - licenseExpiry
//   - businessName
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

    role: z.enum(['customer', 'driver', 'fleet_owner', 'driver_fleet_owner']).default('customer'),

    licenseNumber: z
      .string()
      .trim()
      .min(1, 'License number is required')
      .max(50, 'License number must not exceed 50 characters')
      .optional(),

    licenseExpiry: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'License expiry must be in YYYY-MM-DD format')
      .optional(),

    businessName: z
      .string()
      .trim()
      .min(1, 'Business name is required')
      .max(150, 'Business name must not exceed 150 characters')
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // --------------------------------------------------------
    // Contact validation
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Password confirmation
    // --------------------------------------------------------

    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match',
      });
    }

    // --------------------------------------------------------
    // Role-specific validation
    // --------------------------------------------------------

    const isDriver = data.role === 'driver' || data.role === 'driver_fleet_owner';

    const isFleetOwner = data.role === 'fleet_owner' || data.role === 'driver_fleet_owner';

    // --------------------------------------------------------
    // Driver fields
    // --------------------------------------------------------

    if (isDriver) {
      if (!data.licenseNumber) {
        ctx.addIssue({
          code: 'custom',
          path: ['licenseNumber'],
          message: 'License number is required for driver signup',
        });
      }

      if (!data.licenseExpiry) {
        ctx.addIssue({
          code: 'custom',
          path: ['licenseExpiry'],
          message: 'License expiry is required for driver signup',
        });
      } else {
        const parts = data.licenseExpiry.split('-');

        if (parts.length !== 3) {
          ctx.addIssue({
            code: 'custom',
            path: ['licenseExpiry'],
            message: 'License expiry must be in YYYY-MM-DD format',
          });
        } else {
          const year = Number(parts[0]);
          const month = Number(parts[1]);
          const day = Number(parts[2]);

          const date = new Date(Date.UTC(year, month - 1, day));

          const isValidCalendarDate =
            Number.isInteger(year) &&
            Number.isInteger(month) &&
            Number.isInteger(day) &&
            month >= 1 &&
            month <= 12 &&
            day >= 1 &&
            date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day;

          if (!isValidCalendarDate) {
            ctx.addIssue({
              code: 'custom',
              path: ['licenseExpiry'],
              message: 'License expiry must be a valid calendar date',
            });
          }
        }
      }
    }

    // --------------------------------------------------------
    // Fleet owner fields
    // --------------------------------------------------------

    if (isFleetOwner && !data.businessName) {
      ctx.addIssue({
        code: 'custom',
        path: ['businessName'],
        message: 'Business name is required for fleet owner signup',
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

// ============================================================
// Forgot Password
// ============================================================

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

// ============================================================
// Forgot Password OTP Verification
// ============================================================

export const verifyPasswordResetOtpSchema = z
  .object({
    resetSessionToken: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid password reset session'),

    otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  })
  .strict();

// ============================================================
// Reset Password
// ============================================================

export const resetPasswordSchema = z
  .object({
    resetSessionToken: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid password reset session'),

    password: passwordSchema,

    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match',
      });
    }
  });

// ============================================================
// Change Password
// ============================================================

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'Current password is required')
      .max(128, 'Current password must not exceed 128 characters'),

    newPassword: passwordSchema,

    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.newPassword !== data.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match',
      });
    }

    if (data.currentPassword === data.newPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['newPassword'],
        message: 'New password must be different from current password',
      });
    }
  });

export const googleAuthSchema = z
  .object({
    idToken: z
      .string()
      .min(1)
      .max(16384)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  })
  .strict();
