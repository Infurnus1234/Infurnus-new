import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

import { env } from '../../../config/env.js';

interface RateLimiterConfig {
  windowMs: number;
  limit: number;
  keyGenerator?: (req: Request) => string;
}

const standardRateLimitOptions = {
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
};

export function createRateLimiter({ windowMs, limit, keyGenerator }: RateLimiterConfig) {
  return rateLimit({
    windowMs,
    limit,
    ...standardRateLimitOptions,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      });
    },
  });
}

export const authLoginRateLimiter = createRateLimiter({
  windowMs: env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_LOGIN_RATE_LIMIT_MAX,
});

export const authSignupRateLimiter = createRateLimiter({
  windowMs: env.AUTH_SIGNUP_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_SIGNUP_RATE_LIMIT_MAX,
});

export const authOtpVerifyRateLimiter = createRateLimiter({
  windowMs: env.AUTH_OTP_VERIFY_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_OTP_VERIFY_RATE_LIMIT_MAX,
});

export const authOtpResendRateLimiter = createRateLimiter({
  windowMs: env.AUTH_OTP_RESEND_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_OTP_RESEND_RATE_LIMIT_MAX,
});

export const authRefreshRateLimiter = createRateLimiter({
  windowMs: env.AUTH_REFRESH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_REFRESH_RATE_LIMIT_MAX,
});

export const authLogoutRateLimiter = createRateLimiter({
  windowMs: env.AUTH_LOGOUT_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_LOGOUT_RATE_LIMIT_MAX,
});
