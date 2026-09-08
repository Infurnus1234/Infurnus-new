import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';

import { DevOtpProvider } from '../providers/dev-otp.provider.js';
import type { OtpProvider } from '../providers/otp.provider.js';

import { PostgresAuthUserRepository } from '../repositories/auth-user.repository.js';
import { PostgresLoginRepository } from '../repositories/login.repository.js';
import { PostgresPendingSignupRepository } from '../repositories/pending-signup.repository.js';
import { PostgresRefreshTokenRepository } from '../repositories/refresh-token.repository.js';
import { PostgresSignupCompletionRepository } from '../repositories/signup-completion.repository.js';
import { PostgresSignupUserRepository } from '../repositories/signup-user.repository.js';

import {
  loginSchema,
  resendSignupOtpSchema,
  signupSchema,
  verifySignupOtpSchema,
} from '../schemas/auth.schemas.js';

import { LoginService } from '../services/login.service.js';
import { LogoutService } from '../services/logout.service.js';
import { OtpResendService } from '../services/otp-resend.service.js';
import { RefreshTokenService } from '../services/refresh-token.service.js';
import { SessionService } from '../services/session.service.js';
import { SignupService } from '../services/signup.service.js';
import { SignupVerificationService } from '../services/signup-verification.service.js';
import { TokenService } from '../services/token.service.js';

import { clearCsrfTokenCookie, setCsrfTokenCookie } from '../utils/csrf-cookie.js';
import { generateCsrfToken } from '../utils/csrf.js';
import { clearRefreshTokenCookie, setRefreshTokenCookie } from '../utils/refresh-cookie.js';

// ============================================================
// Controller dependencies
// ============================================================

export interface AuthControllerDependencies {
  signupService: SignupService;
  signupVerificationService: SignupVerificationService;
  otpResendService: OtpResendService;
  loginService: LoginService;
  refreshTokenService: RefreshTokenService;
  logoutService: LogoutService;
  sessionService: SessionService;
  tokenService: TokenService;
  authUserRepository: PostgresAuthUserRepository;
}

// ============================================================
// Controller factory
// ============================================================

export function createAuthController(
  otpProvider: OtpProvider = new DevOtpProvider(),
): AuthControllerDependencies {
  const pendingSignupRepository = new PostgresPendingSignupRepository();

  const signupUserRepository = new PostgresSignupUserRepository();

  const signupCompletionRepository = new PostgresSignupCompletionRepository();

  const refreshTokenRepository = new PostgresRefreshTokenRepository();

  const loginRepository = new PostgresLoginRepository();

  const authUserRepository = new PostgresAuthUserRepository();

  const signupService = new SignupService(
    pendingSignupRepository,
    otpProvider,
    signupUserRepository,
  );

  const signupVerificationService = new SignupVerificationService(signupCompletionRepository);

  const otpResendService = new OtpResendService(pendingSignupRepository, otpProvider);

  const loginService = new LoginService(loginRepository);

  const refreshTokenService = new RefreshTokenService(refreshTokenRepository);

  const logoutService = new LogoutService(refreshTokenRepository);

  const sessionService = new SessionService(refreshTokenRepository);

  const tokenService = new TokenService();

  return {
    signupService,
    signupVerificationService,
    otpResendService,
    loginService,
    refreshTokenService,
    logoutService,
    sessionService,
    tokenService,
    authUserRepository,
  };
}

// ============================================================
// Auth handlers
// ============================================================

export function createAuthHandlers(dependencies: AuthControllerDependencies) {
  const {
    signupService,
    signupVerificationService,
    otpResendService,
    loginService,
    refreshTokenService,
    logoutService,
    sessionService,
    tokenService,
    authUserRepository,
  } = dependencies;

  // ==========================================================
  // POST /auth/signup
  // ==========================================================

  async function signup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = signupSchema.parse(req.body);

      const result = await signupService.signup({
        firstName: input.firstName,
        lastName: input.lastName,
        password: input.password,
        role: input.role,
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      });

      res.status(201).json({
        success: true,
        data: {
          signupId: result.signupId,
          contactType: result.contactType,
          expiresAt: result.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================================
  // POST /auth/signup/verify
  // ==========================================================

  async function verifySignup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = verifySignupOtpSchema.parse(req.body);

      const result = await signupVerificationService.verify(input.signupId, input.otp);

      const accessToken = await tokenService.createAccessToken({
        userId: result.userId,
        role: result.role,
      });

      const refreshToken = await refreshTokenService.create(result.userId, {
        userAgent: req.get('user-agent') ?? null,
        ipAddress: req.ip ?? null,
      });

      setRefreshTokenCookie(res, refreshToken.refreshToken);
      setCsrfTokenCookie(res, generateCsrfToken());

      res.status(200).json({
        success: true,
        data: {
          userId: result.userId,
          accessToken,
          expiresAt: refreshToken.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================================
  // POST /auth/signup/resend
  // ==========================================================

  async function resendSignupOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = resendSignupOtpSchema.parse(req.body);

      const result = await otpResendService.resend({
        signupId: input.signupId,
      });

      res.status(200).json({
        success: true,
        data: {
          signupId: result.signupId,
          contactType: result.contactType,
          expiresAt: result.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================================
  // POST /auth/login
  // ==========================================================

  async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginSchema.parse(req.body);

      const result = await loginService.authenticate({
        password: input.password,
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      });

      const accessToken = await tokenService.createAccessToken({
        userId: result.userId,
        role: result.role,
      });

      const refreshToken = await refreshTokenService.create(result.userId, {
        userAgent: req.get('user-agent') ?? null,
        ipAddress: req.ip ?? null,
      });

      setRefreshTokenCookie(res, refreshToken.refreshToken);
      setCsrfTokenCookie(res, generateCsrfToken());

      res.status(200).json({
        success: true,
        data: {
          userId: result.userId,
          accessToken,
          expiresAt: refreshToken.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================================
  // POST /auth/refresh
  // ==========================================================

  async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawRefreshToken = req.cookies?.[env.AUTH_REFRESH_COOKIE_NAME];

      if (typeof rawRefreshToken !== 'string' || !rawRefreshToken) {
        throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid refresh token', 401);
      }

      const rotated = await refreshTokenService.rotate(rawRefreshToken, {
        userAgent: req.get('user-agent') ?? null,
        ipAddress: req.ip ?? null,
      });

      const identity = await authUserRepository.findIdentityById(rotated.userId);

      if (!identity) {
        throw new AppError('INVALID_USER', 'User not found', 401);
      }

      if (identity.status !== 'active') {
        throw new AppError('ACCOUNT_NOT_ACTIVE', 'Account is not active', 401);
      }

      const accessToken = await tokenService.createAccessToken({
        userId: rotated.userId,
        role: identity.role,
      });

      setRefreshTokenCookie(res, rotated.refreshToken);

      res.status(200).json({
        success: true,
        data: {
          accessToken,
          expiresAt: rotated.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================================
  // POST /auth/logout
  // ==========================================================

  async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawRefreshToken = req.cookies?.[env.AUTH_REFRESH_COOKIE_NAME];

      if (typeof rawRefreshToken !== 'string' || !rawRefreshToken) {
        throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid refresh token', 401);
      }

      await logoutService.logout(rawRefreshToken);

      clearRefreshTokenCookie(res);
      clearCsrfTokenCookie(res);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // ==========================================================
  // POST /auth/logout-all
  // ==========================================================

  async function logoutAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth?.userId) {
        throw new AppError('AUTHENTICATION_REQUIRED', 'Authentication required', 401);
      }

      await logoutService.logoutAllForUser(req.auth.userId);

      clearRefreshTokenCookie(res);
      clearCsrfTokenCookie(res);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // ==========================================================
  // GET /auth/sessions
  // ==========================================================

  async function listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth?.userId) {
        throw new AppError('AUTHENTICATION_REQUIRED', 'Authentication required', 401);
      }

      const sessions = await sessionService.listActiveSessions(req.auth.userId);

      res.status(200).json({
        success: true,
        data: {
          sessions,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==========================================================
  // DELETE /auth/sessions/:sessionId
  // ==========================================================

  async function revokeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.auth?.userId) {
        throw new AppError('AUTHENTICATION_REQUIRED', 'Authentication required', 401);
      }

      const sessionId = req.params.sessionId;

      if (typeof sessionId !== 'string' || !sessionId) {
        throw new AppError('INVALID_SESSION', 'Invalid session', 400);
      }

      await sessionService.revokeSession(req.auth.userId, sessionId);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  return {
    signup,
    verifySignup,
    resendSignupOtp,
    login,
    refresh,
    logout,
    logoutAll,
    listSessions,
    revokeSession,
  };
}

// ============================================================
// Default controller / handlers
//
// Kept for existing imports and unit tests.
// ============================================================

export const defaultAuthController = createAuthController();

export const defaultAuthHandlers = createAuthHandlers(defaultAuthController);

export const signup = defaultAuthHandlers.signup;

export const verifySignup = defaultAuthHandlers.verifySignup;

export const resendSignupOtp = defaultAuthHandlers.resendSignupOtp;

export const login = defaultAuthHandlers.login;

export const refresh = defaultAuthHandlers.refresh;

export const logout = defaultAuthHandlers.logout;

export const logoutAll = defaultAuthHandlers.logoutAll;

export const listSessions = defaultAuthHandlers.listSessions;

export const revokeSession = defaultAuthHandlers.revokeSession;
