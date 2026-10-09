import 'dotenv/config';
import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),

    PORT: z.coerce.number().int().positive().default(3000),
    // Explicit no-ownership preview: an idle serving revision must retain priority.
    BACKEND_STANDBY: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .default(false)
      .transform((value) => value === true || value === 'true'),

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

    AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

    AUTH_SIGNUP_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_SIGNUP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    AUTH_OTP_VERIFY_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1000),

    AUTH_OTP_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

    AUTH_OTP_RESEND_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1000),

    AUTH_OTP_RESEND_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    AUTH_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),

    AUTH_REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

    AUTH_LOGOUT_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_LOGOUT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

    // ============================================================
    // Forgot Password Rate Limits
    // ============================================================

    AUTH_FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    AUTH_PASSWORD_RESET_VERIFY_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1000),

    AUTH_PASSWORD_RESET_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

    AUTH_PASSWORD_RESET_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

    AUTH_PASSWORD_RESET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    AUTH_GOOGLE_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    AUTH_GOOGLE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

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

    MAX_DRIVER_MATCH_CANDIDATES: z.coerce.number().int().positive().max(25).default(20),

    DRIVER_DISPATCH_RESPONSE_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

    // ============================================================
    // Google Maps
    // ============================================================

    // Common maps: cache TTLs are seconds; intervals are milliseconds.
    MAP_SERVICE_AREA_BOUNDARY_FILE: z.string().min(1).optional(),

    MAP_REGION: z.string().trim().min(1).default('Bihar'),
    MAP_COUNTRY: z
      .string()
      .regex(/^[a-z]{2}$/)
      .default('in'),
    MAP_SEARCH_CACHE_TTL: z.coerce.number().int().min(0).max(86400).default(300),
    MAP_GEOCODE_CACHE_TTL: z.coerce.number().int().min(0).max(2592000).default(86400),
    MAP_REVERSE_CACHE_TTL: z.coerce.number().int().min(0).max(86400).default(600),
    MAP_ROUTE_CACHE_TTL: z.coerce.number().int().min(0).max(600).default(120),
    MAP_DISTANCE_CACHE_TTL: z.coerce.number().int().min(0).max(600).default(120),
    MAP_POPULAR_CACHE_TTL: z.coerce.number().int().min(0).max(86400).default(3600),
    MAP_REVERSE_PRECISION: z.coerce.number().int().min(3).max(6).default(4),
    MAP_MOVEMENT_THRESHOLD_METERS: z.coerce.number().positive().default(10),
    MAP_OFF_ROUTE_ENTER_METERS: z.coerce.number().positive().default(60),
    MAP_OFF_ROUTE_EXIT_METERS: z.coerce.number().positive().default(20),
    MAP_MIN_REROUTE_INTERVAL_MS: z.coerce.number().int().min(10000).default(10000),
    MAP_ROUTE_REFRESH_MS: z.coerce.number().int().min(10000).default(120000),
    MAP_CACHE_TIMEOUT_MS: z.coerce.number().int().positive().max(1000).default(100),
    MAP_REQUEST_LOCK_MS: z.coerce.number().int().min(20000).max(60000).default(30000),
    MAP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    // Enable only when the selected provider agreement permits content storage.
    MAP_PROVIDER_CONTENT_CACHING: z.preprocess(
      (v) => (v === 'true' ? true : v === 'false' ? false : v),
      z.boolean().default(false),
    ),
    MAP_DRIVER_RADII_METERS: z
      .string()
      .default('1000,2000')
      .transform((v) => v.split(',').map(Number))
      .refine(
        (v) =>
          v.length > 0 &&
          v.length <= 5 &&
          v.every(
            (n, i) => Number.isFinite(n) && n > 0 && n <= 50000 && (i === 0 || n > v[i - 1]!),
          ),
        'Driver radii must be increasing, positive and bounded',
      ),
    GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),

    GOOGLE_ROUTE_RECALCULATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),

    GOOGLE_ROUTE_RECALCULATION_DISTANCE_METERS: z.coerce.number().positive().default(500),

    GOOGLE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(10000).default(5000),

    GOOGLE_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),

    GOOGLE_PLACES_MIN_QUERY_LENGTH: z.coerce.number().int().min(1).default(1),

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
    // Cloudinary Storage
    // ============================================================

    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),

    CLOUDINARY_API_KEY: z.string().min(1).optional(),

    CLOUDINARY_API_SECRET: z.string().min(1).optional(),

    // ============================================================
    // Authentication delivery configuration
    // ============================================================

    GOOGLE_WEB_CLIENT_ID: z.string().trim().min(1).optional(),
    GOOGLE_ANDROID_CLIENT_ID: z.string().trim().min(1).optional(),

    OTP_PROVIDER_CONFIG: z.string().optional(),

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

    // ============================================================
    // Cashfree Payouts
    // ============================================================

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
    if (
      config.MAP_REQUEST_LOCK_MS <
      config.GOOGLE_REQUEST_TIMEOUT_MS * (config.GOOGLE_MAX_RETRIES + 1) + 1000
    )
      ctx.addIssue({
        code: 'custom',
        path: ['MAP_REQUEST_LOCK_MS'],
        message:
          'Map request lock must cover the bounded Google request/retry budget plus one second',
      });
    if (config.MAP_OFF_ROUTE_EXIT_METERS >= config.MAP_OFF_ROUTE_ENTER_METERS)
      ctx.addIssue({
        code: 'custom',
        path: ['MAP_OFF_ROUTE_EXIT_METERS'],
        message: 'Off-route exit must be below enter threshold',
      });
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

    // ============================================================
    // Cloudinary Configuration Validation
    // ============================================================

    const cloudinaryValuesProvided =
      config.CLOUDINARY_CLOUD_NAME || config.CLOUDINARY_API_KEY || config.CLOUDINARY_API_SECRET;

    const cloudinaryConfigurationComplete =
      config.CLOUDINARY_CLOUD_NAME && config.CLOUDINARY_API_KEY && config.CLOUDINARY_API_SECRET;

    if (cloudinaryValuesProvided && !cloudinaryConfigurationComplete) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLOUDINARY_CLOUD_NAME'],
        message:
          'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must all be provided together',
      });
    }

    if (config.NODE_ENV === 'production' && !cloudinaryConfigurationComplete) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLOUDINARY_CLOUD_NAME'],
        message:
          'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required in production',
      });
    }
  });

export const env = envSchema.parse(process.env);
