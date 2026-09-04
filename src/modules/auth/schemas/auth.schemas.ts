import { z } from 'zod';

// ============================================================
// Shared password validation
// ============================================================

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must not exceed 128 characters');

// ============================================================
// Signup
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

    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .max(320, 'Email must not exceed 320 characters')
      .optional(),

    phone: z
      .string()
      .trim()
      .min(7, 'Invalid phone number')
      .max(20, 'Phone number must not exceed 20 characters')
      .optional(),

    password: passwordSchema,

    confirmPassword: z.string().min(1, 'Please confirm your password'),

    role: z.enum(['customer', 'driver']).default('customer'),
  })
  .superRefine((data, ctx) => {
    if (!data.email && !data.phone) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Email or phone number is required',
      });
    }

    if (data.email && data.phone) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Provide either email or phone number, not both',
      });
    }

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

export const verifySignupOtpSchema = z.object({
  signupId: z.string().uuid('Invalid signup ID'),

  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

// ============================================================
// Signup OTP resend
// ============================================================

export const resendSignupOtpSchema = z.object({
  signupId: z.string().uuid('Invalid signup ID'),
});

// ============================================================
// Login
// ============================================================

export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .max(320, 'Email must not exceed 320 characters')
      .optional(),

    phone: z
      .string()
      .trim()
      .min(7, 'Invalid phone number')
      .max(20, 'Phone number must not exceed 20 characters')
      .optional(),

    password: z
      .string()
      .min(1, 'Password is required')
      .max(128, 'Password must not exceed 128 characters'),
  })
  .superRefine((data, ctx) => {
    if (!data.email && !data.phone) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Email or phone number is required',
      });
    }

    if (data.email && data.phone) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Provide either email or phone number, not both',
      });
    }
  });
