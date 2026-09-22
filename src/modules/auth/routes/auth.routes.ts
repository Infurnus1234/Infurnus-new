import { Router } from 'express';

import type { AuthControllerDependencies } from '../controllers/auth.controller.js';

import { createAuthHandlers } from '../controllers/auth.controller.js';

import { requireAuth } from '../middleware/auth.middleware.js';

import { requireCsrf } from '../middleware/csrf.middleware.js';

import {
  authForgotPasswordRateLimiter,
  authLoginRateLimiter,
  authLogoutRateLimiter,
  authOtpResendRateLimiter,
  authOtpVerifyRateLimiter,
  authPasswordResetRateLimiter,
  authPasswordResetVerifyRateLimiter,
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
    verifyLogin,
    resendLoginOtp,

    forgotPassword,
    verifyPasswordResetOtp,
    resetPassword,
    changePassword,
    deleteAccount,

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
  // POST /auth/login/verify
  // ==========================================================

  router.post(
    '/login/verify',
    ...(enableRateLimiting ? [authOtpVerifyRateLimiter] : []),
    verifyLogin,
  );

  // ==========================================================
  // POST /auth/login/resend
  // ==========================================================

  router.post(
    '/login/resend',
    ...(enableRateLimiting ? [authOtpResendRateLimiter] : []),
    resendLoginOtp,
  );

  // ==========================================================
  // POST /auth/forgot-password
  //
  // Public endpoint.
  //
  // Sends a password reset OTP through the configured
  // OTP provider.
  //
  // No authentication or CSRF protection is required.
  // ==========================================================

  router.post(
    '/forgot-password',
    ...(enableRateLimiting ? [authForgotPasswordRateLimiter] : []),
    forgotPassword,
  );

  // ==========================================================
  // POST /auth/forgot-password/verify
  //
  // Public endpoint.
  //
  // Verifies the password reset OTP.
  //
  // No authentication or CSRF protection is required.
  // ==========================================================

  router.post(
    '/forgot-password/verify',
    ...(enableRateLimiting ? [authPasswordResetVerifyRateLimiter] : []),
    verifyPasswordResetOtp,
  );

  // ==========================================================
  // POST /auth/reset-password
  //
  // Public endpoint.
  //
  // Requires a previously verified password reset session.
  //
  // No authentication or CSRF protection is required.
  // ==========================================================

  router.post(
    '/reset-password',
    ...(enableRateLimiting ? [authPasswordResetRateLimiter] : []),
    resetPassword,
  );

  // ==========================================================
  // POST /auth/change-password
  // ==========================================================

  router.post('/change-password', requireAuth, changePassword);

  // ==========================================================
  // DELETE /auth/account
  // ==========================================================

  router.delete(
    '/account',
    ...(enableRateLimiting ? [authLogoutRateLimiter] : []),
    requireAuth,
    ...(enableCsrfProtection ? [requireCsrf] : []),
    deleteAccount,
  );

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
