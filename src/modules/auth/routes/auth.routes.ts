import { Router } from 'express';

import type { AuthControllerDependencies } from '../controllers/auth.controller.js';
import { createAuthHandlers } from '../controllers/auth.controller.js';

import { requireAuth } from '../middleware/auth.middleware.js';
import { requireCsrf } from '../middleware/csrf.middleware.js';

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
  enableCsrfProtection?: boolean;
}

export function createAuthRouter(
  dependencies: AuthControllerDependencies,
  options: AuthRouterOptions = {},
) {
  const router = Router();

  const {
    signup,
    verifySignup,
    resendSignupOtp,
    login,
    refresh,
    logout,
    logoutAll,
    listSessions,
    revokeSession,
  } = createAuthHandlers(dependencies);

  const enableRateLimiting = options.enableRateLimiting ?? true;
  const enableCsrfProtection = options.enableCsrfProtection ?? true;

  // ==========================================================
  // POST /auth/signup
  // ==========================================================

  router.post('/signup', ...(enableRateLimiting ? [authSignupRateLimiter] : []), signup);

  // ==========================================================
  // POST /auth/signup/verify
  // ==========================================================

  router.post(
    '/signup/verify',
    ...(enableRateLimiting ? [authOtpVerifyRateLimiter] : []),
    verifySignup,
  );

  // ==========================================================
  // POST /auth/signup/resend
  // ==========================================================

  router.post(
    '/signup/resend',
    ...(enableRateLimiting ? [authOtpResendRateLimiter] : []),
    resendSignupOtp,
  );

  // ==========================================================
  // POST /auth/login
  // ==========================================================

  router.post('/login', ...(enableRateLimiting ? [authLoginRateLimiter] : []), login);

  // ==========================================================
  // POST /auth/refresh
  // ==========================================================

  router.post(
    '/refresh',
    ...(enableRateLimiting ? [authRefreshRateLimiter] : []),
    ...(enableCsrfProtection ? [requireCsrf] : []),
    refresh,
  );

  // ==========================================================
  // POST /auth/logout
  // ==========================================================

  router.post(
    '/logout',
    ...(enableRateLimiting ? [authLogoutRateLimiter] : []),
    ...(enableCsrfProtection ? [requireCsrf] : []),
    logout,
  );

  // ==========================================================
  // POST /auth/logout-all
  // ==========================================================

  router.post(
    '/logout-all',
    ...(enableRateLimiting ? [authLogoutRateLimiter] : []),
    requireAuth,
    ...(enableCsrfProtection ? [requireCsrf] : []),
    logoutAll,
  );

  // ==========================================================
  // GET /auth/sessions
  // ==========================================================

  router.get('/sessions', requireAuth, listSessions);

  // ==========================================================
  // DELETE /auth/sessions/:sessionId
  // ==========================================================

  router.delete(
    '/sessions/:sessionId',
    ...(enableRateLimiting ? [authLogoutRateLimiter] : []),
    requireAuth,
    ...(enableCsrfProtection ? [requireCsrf] : []),
    revokeSession,
  );

  return router;
}
