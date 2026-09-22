import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),

    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    CORS_CREDENTIALS: z.coerce.boolean().default(true),

    // ============================================================
    // JWT
    // ============================================================

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),

    JWT_ACCESS_PREVIOUS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_PREVIOUS_SECRET must be at least 32 characters')
      .optional(),

    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),

    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

    // ============================================================
    // Authentication Cookies
    // ============================================================

    AUTH_REFRESH_COOKIE_NAME: z.string().min(1).default('infurnus_refresh_token'),

    AUTH_REFRESH_COOKIE_SECURE: z.coerce.boolean().default(false),

    AUTH_REFRESH_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),

    AUTH_CSRF_COOKIE_NAME: z.string().min(1).default('infurnus_csrf_token'),

    AUTH_CSRF_COOKIE_SECURE: z.coerce.boolean().default(false),

    AUTH_CSRF_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),

    // ============================================================
    // Authentication Rate Limits
    // ============================================================

    AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    AUTH_SIGNUP_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_SIGNUP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

    AUTH_OTP_VERIFY_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1000),

    AUTH_OTP_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    AUTH_OTP_RESEND_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1000),

    AUTH_OTP_RESEND_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

    AUTH_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),

    AUTH_REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

    AUTH_LOGOUT_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_LOGOUT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

    // ============================================================
    // Forgot Password Rate Limits
    // ============================================================

    AUTH_FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

    AUTH_PASSWORD_RESET_VERIFY_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1000),

    AUTH_PASSWORD_RESET_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    AUTH_PASSWORD_RESET_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_PASSWORD_RESET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

    AUTH_RATE_LIMIT_ENABLED: z.preprocess((val) => {
      if (typeof val === 'string') {
        if (val.toLowerCase() === 'false') return false;
        if (val.toLowerCase() === 'true') return true;
      }

      return val;
    }, z.coerce.boolean().default(true)),

    // ============================================================
    // Driver Matching
    // ============================================================

    DRIVER_LOCATION_STALE_SECONDS: z.coerce.number().int().positive().default(30),

    DRIVER_SEARCH_RADIUS_METERS: z.coerce.number().positive().default(5000),

    MAX_DRIVER_MATCH_CANDIDATES: z.coerce.number().int().positive().default(20),

    // ============================================================
    // Google Maps
    // ============================================================

    GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),

    GOOGLE_ROUTE_RECALCULATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),

    GOOGLE_ROUTE_RECALCULATION_DISTANCE_METERS: z.coerce.number().positive().default(500),

    GOOGLE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

    GOOGLE_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),

    GOOGLE_PLACES_MIN_QUERY_LENGTH: z.coerce.number().int().min(1).default(3),

    GOOGLE_PLACES_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(300),

    // ============================================================
    // Redis
    // ============================================================

    REDIS_URL: z.string().min(1, 'REDIS_URL must not be empty').optional(),

    REDIS_MAX_RETRIES: z.coerce.number().int().min(0).default(3),

    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    // ============================================================
    // Notifications
    // ============================================================

    NOTIFICATION_QUEUE_NAME: z.string().min(1).default('infurnus-notifications'),

    NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

    NOTIFICATION_BACKOFF_DELAY_MS: z.coerce.number().int().positive().default(5000),

    // ============================================================
    // Firebase / FCM
    // ============================================================

    FIREBASE_PROJECT_ID: z.string().min(1).optional(),

    FIREBASE_CLIENT_EMAIL: z.string().email().optional(),

    FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),

    // ============================================================
    // Sendmator
    // ============================================================

    SENDMATOR_API_KEY: z.string().min(1, 'SENDMATOR_API_KEY must not be empty').optional(),

    // ============================================================
    // Resend Email Provider
    // ============================================================

    RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY must not be empty').optional(),

    RESEND_FROM_EMAIL: z
      .string()
      .email('RESEND_FROM_EMAIL must be a valid email address')
      .default('onboarding@resend.dev'),

    // ============================================================
    // Cashfree Payment Gateway
    // ============================================================

    CASHFREE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),

    CASHFREE_CLIENT_ID: z.string().min(1).optional(),

    CASHFREE_CLIENT_SECRET: z.string().min(1).optional(),

    CASHFREE_API_VERSION: z.string().min(1).default('2023-08-01'),

    CASHFREE_BASE_URL: z.string().url().default('https://sandbox.cashfree.com/pg'),

    // Cashfree Payouts

    CASHFREE_PAYOUT_CLIENT_ID: z.string().min(1).optional(),

    CASHFREE_PAYOUT_CLIENT_SECRET: z.string().min(1).optional(),

    // ============================================================
    // Authentication Challenge Encryption
    // ============================================================

    AUTH_OTP_ENCRYPTION_KEY: z
      .string()
      .min(1, 'AUTH_OTP_ENCRYPTION_KEY is required')
      .refine(
        (value) => {
          try {
            const decoded = Buffer.from(value, 'base64');

            return decoded.length === 32;
          } catch {
            return false;
          }
        },
        {
          message: 'AUTH_OTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
        },
      ),
  })
  .superRefine((config, ctx) => {
    // ============================================================
    // Cookie Security
    // ============================================================

    if (config.AUTH_REFRESH_COOKIE_SAME_SITE === 'none' && !config.AUTH_REFRESH_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_REFRESH_COOKIE_SECURE'],
        message: 'AUTH_REFRESH_COOKIE_SECURE must be true when SameSite is none',
      });
    }

    if (config.AUTH_CSRF_COOKIE_SAME_SITE === 'none' && !config.AUTH_CSRF_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_CSRF_COOKIE_SECURE'],
        message: 'AUTH_CSRF_COOKIE_SECURE must be true when SameSite is none',
      });
    }

    // ============================================================
    // Production Security
    // ============================================================

    if (config.NODE_ENV === 'production') {
      if (
        config.JWT_ACCESS_SECRET === 'replace-with-a-random-secret-at-least-32-characters' ||
        config.JWT_ACCESS_SECRET.includes('replace-with')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET must not use placeholder values in production',
        });
      }

      if (!config.AUTH_REFRESH_COOKIE_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_REFRESH_COOKIE_SECURE'],
          message: 'AUTH_REFRESH_COOKIE_SECURE must be true in production',
        });
      }

      if (!config.AUTH_CSRF_COOKIE_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_CSRF_COOKIE_SECURE'],
          message: 'AUTH_CSRF_COOKIE_SECURE must be true in production',
        });
      }

      // ============================================================
      // Production Cashfree Validation
      // ============================================================

      if (config.CASHFREE_ENV === 'production') {
        if (!config.CASHFREE_CLIENT_ID || !config.CASHFREE_CLIENT_SECRET) {
          ctx.addIssue({
            code: 'custom',
            path: ['CASHFREE_CLIENT_ID'],
            message:
              'CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET are required when CASHFREE_ENV is production',
          });
        }
      }
    }

    // ============================================================
    // Firebase Configuration Validation
    // ============================================================

    const firebaseValuesProvided =
      config.FIREBASE_PROJECT_ID || config.FIREBASE_CLIENT_EMAIL || config.FIREBASE_PRIVATE_KEY;

    const firebaseConfigurationComplete =
      config.FIREBASE_PROJECT_ID && config.FIREBASE_CLIENT_EMAIL && config.FIREBASE_PRIVATE_KEY;

    if (firebaseValuesProvided && !firebaseConfigurationComplete) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIREBASE_PROJECT_ID'],
        message:
          'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must all be provided together',
      });
    }
  });

export const env = envSchema.parse(process.env);
