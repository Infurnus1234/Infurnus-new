import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    CORS_CREDENTIALS: z.coerce.boolean().default(true),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_PREVIOUS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_PREVIOUS_SECRET must be at least 32 characters')
      .optional(),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),

    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

    AUTH_REFRESH_COOKIE_NAME: z.string().min(1).default('infurnus_refresh_token'),
    AUTH_REFRESH_COOKIE_SECURE: z.coerce.boolean().default(false),
    AUTH_REFRESH_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),

    AUTH_CSRF_COOKIE_NAME: z.string().min(1).default('infurnus_csrf_token'),
    AUTH_CSRF_COOKIE_SECURE: z.coerce.boolean().default(false),
    AUTH_CSRF_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),

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

    AUTH_REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    AUTH_REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

    DRIVER_LOCATION_STALE_SECONDS: z.coerce.number().int().positive().default(30),
    DRIVER_SEARCH_RADIUS_METERS: z.coerce.number().positive().default(5000),
    MAX_DRIVER_MATCH_CANDIDATES: z.coerce.number().int().positive().default(20),
    GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),
    GOOGLE_ROUTE_RECALCULATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
    GOOGLE_ROUTE_RECALCULATION_DISTANCE_METERS: z.coerce.number().positive().default(500),
    GOOGLE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    GOOGLE_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
    GOOGLE_PLACES_MIN_QUERY_LENGTH: z.coerce.number().int().min(1).default(3),
    GOOGLE_PLACES_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(300),

    AUTH_LOGOUT_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    AUTH_LOGOUT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  })
  .superRefine((config, ctx) => {
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
  });

export const env = envSchema.parse(process.env);
