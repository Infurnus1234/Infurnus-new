import { Router } from 'express';

import type { AuthControllerDependencies } from '../controllers/auth.controller.js';
import { createAuthHandlers } from '../controllers/auth.controller.js';

import { requireAuth } from '../middleware/auth.middleware.js';
import {
  authLoginRateLimiter,
  authLogoutRateLimiter,
  authOtpResendRateLimiter,
  authOtpVerifyRateLimiter,
  authRefreshRateLimiter,
  authSignupRateLimiter,
} from '../middleware/rate-limit.middleware.js';

export interface AuthRouterOptions {
  enableRateLimiting?: boolean;
}

export function createAuthRouter(
  dependencies: AuthControllerDependencies,
  options: AuthRouterOptions = {},
) {
  const router = Router();

  const { signup, verifySignup, resendSignupOtp, login, refresh, logout, logoutAll } =
    createAuthHandlers(dependencies);

  const enableRateLimiting = options.enableRateLimiting ?? true;

  router.post(
    '/signup',
    ...(enableRateLimiting ? [authSignupRateLimiter] : []),
    signup,
  );

  router.post(
    '/signup/verify',
    ...(enableRateLimiting ? [authOtpVerifyRateLimiter] : []),
    verifySignup,
  );

  router.post(
    '/signup/resend',
    ...(enableRateLimiting ? [authOtpResendRateLimiter] : []),
    resendSignupOtp,
  );

  router.post(
    '/login',
    ...(enableRateLimiting ? [authLoginRateLimiter] : []),
    login,
  );

  router.post(
    '/refresh',
    ...(enableRateLimiting ? [authRefreshRateLimiter] : []),
    refresh,
  );

  router.post(
    '/logout',
    ...(enableRateLimiting ? [authLogoutRateLimiter] : []),
    logout,
  );

  router.post(
    '/logout-all',
    ...(enableRateLimiting ? [authLogoutRateLimiter] : []),
    requireAuth,
    logoutAll,
  );

  return router;
}