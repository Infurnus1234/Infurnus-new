import cookieParser from 'cookie-parser';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { env } from '../../../config/env.js';

import type { AuthControllerDependencies } from '../controllers/auth.controller.js';
import { requireCsrf } from '../middleware/csrf.middleware.js';
import { createAuthRouter } from '../routes/auth.routes.js';

import { setCsrfTokenCookie } from '../utils/csrf-cookie.js';
import { generateCsrfToken } from '../utils/csrf.js';

// ============================================================
// Test helpers
// ============================================================

function createCsrfTestApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  app.post('/protected', requireCsrf, (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        status: 'protected-route-reached',
      },
    });
  });

  app.use(errorMiddleware);

  return app;
}

function createAuthCsrfTestApp() {
  const refresh = vi.fn(async (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      data: {
        accessToken: 'test-access-token',
      },
    });
  });

  const logout = vi.fn(async (_req: Request, res: Response) => {
    res.status(204).send();
  });

  const dependencies = {
    signupService: {
      signup: vi.fn(),
    },
    signupVerificationService: {
      verify: vi.fn(),
    },
    otpResendService: {
      resend: vi.fn(),
    },
    loginService: {
      authenticate: vi.fn(),
    },
    refreshTokenService: {
      create: vi.fn(),
      rotate: vi.fn().mockResolvedValue({
        refreshToken: 'rotated-refresh-token',
        refreshTokenId: 'refresh-token-id',
        familyId: 'token-family-id',
        userId: 'user-id',
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    },
    logoutService: {
      logout: vi.fn().mockResolvedValue(undefined),
      logoutFamily: vi.fn(),
      logoutAllForUser: vi.fn(),
    },
    tokenService: {
      createAccessToken: vi.fn().mockResolvedValue('test-access-token'),
    },
    authUserRepository: {
      findIdentityById: vi.fn().mockResolvedValue({
        id: 'user-id',
        role: 'customer',
        status: 'active',
      }),
    },
  } as unknown as AuthControllerDependencies;

  const router = createAuthRouter(dependencies, {
    enableRateLimiting: false,
  });

  const app = express();

  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', router);
  app.use(errorMiddleware);

  return {
    app,
    refresh,
    logout,
    dependencies,
  };
}

function getCsrfCookieHeader(token: string): string {
  return `${env.AUTH_CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function getRefreshCookieHeader(token = 'test-refresh-token'): string {
  return `${env.AUTH_REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

// ============================================================
// CSRF Middleware
// ============================================================

describe('CSRF protection', () => {
  describe('CSRF middleware', () => {
    it('rejects a request when the CSRF cookie is missing', async () => {
      const app = createCsrfTestApp();

      const response = await request(app)
        .post('/protected')
        .set('X-CSRF-Token', generateCsrfToken())
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'CSRF_TOKEN_REQUIRED',
          message: 'CSRF token required',
        },
      });
    });

    it('rejects a request when the CSRF header is missing', async () => {
      const app = createCsrfTestApp();
      const csrfToken = generateCsrfToken();

      const response = await request(app)
        .post('/protected')
        .set('Cookie', getCsrfCookieHeader(csrfToken))
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'CSRF_TOKEN_REQUIRED',
          message: 'CSRF token required',
        },
      });
    });

    it('rejects a request when the CSRF cookie and header do not match', async () => {
      const app = createCsrfTestApp();

      const cookieToken = generateCsrfToken();
      const headerToken = generateCsrfToken();

      const response = await request(app)
        .post('/protected')
        .set('Cookie', getCsrfCookieHeader(cookieToken))
        .set('X-CSRF-Token', headerToken)
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'INVALID_CSRF_TOKEN',
          message: 'Invalid CSRF token',
        },
      });
    });

    it('allows a request when the CSRF cookie and header match', async () => {
      const app = createCsrfTestApp();
      const csrfToken = generateCsrfToken();

      const response = await request(app)
        .post('/protected')
        .set('Cookie', getCsrfCookieHeader(csrfToken))
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          status: 'protected-route-reached',
        },
      });
    });

    it('rejects an empty CSRF cookie value', async () => {
      const app = createCsrfTestApp();

      const response = await request(app)
        .post('/protected')
        .set('Cookie', `${env.AUTH_CSRF_COOKIE_NAME}=`)
        .set('X-CSRF-Token', generateCsrfToken())
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'CSRF_TOKEN_REQUIRED',
          message: 'CSRF token required',
        },
      });
    });

    it('rejects an empty CSRF header value', async () => {
      const app = createCsrfTestApp();
      const csrfToken = generateCsrfToken();

      const response = await request(app)
        .post('/protected')
        .set('Cookie', getCsrfCookieHeader(csrfToken))
        .set('X-CSRF-Token', '')
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'CSRF_TOKEN_REQUIRED',
          message: 'CSRF token required',
        },
      });
    });
  });

  // ==========================================================
  // Auth route enforcement
  // ==========================================================

  describe('Auth protected routes', () => {
    it('protects POST /auth/refresh with CSRF validation', async () => {
      const { app, dependencies } = createAuthCsrfTestApp();

      const csrfToken = generateCsrfToken();

      const response = await request(app)
        .post('/auth/refresh')
        .set('Cookie', [getRefreshCookieHeader(), getCsrfCookieHeader(csrfToken)])
        .set('X-CSRF-Token', csrfToken)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          accessToken: 'test-access-token',
          expiresAt: expect.any(String),
        },
      });

      expect(dependencies.refreshTokenService.rotate).toHaveBeenCalledTimes(1);

      expect(dependencies.tokenService.createAccessToken).toHaveBeenCalledTimes(1);
    });

    it('rejects POST /auth/refresh without a valid CSRF token', async () => {
      const { app, dependencies } = createAuthCsrfTestApp();

      const csrfToken = generateCsrfToken();

      const response = await request(app)
        .post('/auth/refresh')
        .set('Cookie', [getRefreshCookieHeader(), getCsrfCookieHeader(csrfToken)])
        .set('X-CSRF-Token', generateCsrfToken())
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'INVALID_CSRF_TOKEN',
          message: 'Invalid CSRF token',
        },
      });

      expect(dependencies.refreshTokenService.rotate).not.toHaveBeenCalled();
    });

    it('protects POST /auth/logout with CSRF validation', async () => {
      const { app, dependencies } = createAuthCsrfTestApp();

      const csrfToken = generateCsrfToken();

      const response = await request(app)
        .post('/auth/logout')
        .set('Cookie', [getRefreshCookieHeader(), getCsrfCookieHeader(csrfToken)])
        .set('X-CSRF-Token', csrfToken)
        .expect(204);

      expect(response.status).toBe(204);

      expect(dependencies.logoutService.logout).toHaveBeenCalledTimes(1);
    });

    it('rejects POST /auth/logout without a valid CSRF token', async () => {
      const { app, dependencies } = createAuthCsrfTestApp();

      const csrfToken = generateCsrfToken();

      const response = await request(app)
        .post('/auth/logout')
        .set('Cookie', [getRefreshCookieHeader(), getCsrfCookieHeader(csrfToken)])
        .set('X-CSRF-Token', generateCsrfToken())
        .expect(403);

      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'INVALID_CSRF_TOKEN',
          message: 'Invalid CSRF token',
        },
      });

      expect(dependencies.logoutService.logout).not.toHaveBeenCalled();
    });
  });

  // ==========================================================
  // CSRF token generation
  // ==========================================================

  describe('CSRF token generation', () => {
    it('generates unpredictable tokens with the expected encoded length', () => {
      const firstToken = generateCsrfToken();
      const secondToken = generateCsrfToken();

      expect(firstToken).toEqual(expect.any(String));
      expect(secondToken).toEqual(expect.any(String));

      expect(firstToken).toHaveLength(43);
      expect(secondToken).toHaveLength(43);

      expect(firstToken).not.toBe(secondToken);
    });

    it('can be issued through the CSRF cookie utility', async () => {
      const app = express();

      app.get('/csrf', (_req, res) => {
        const csrfToken = generateCsrfToken();

        setCsrfTokenCookie(res, csrfToken);

        res.status(200).json({
          success: true,
        });
      });

      const response = await request(app).get('/csrf').expect(200);

      const setCookieHeaders = response.headers['set-cookie'];

      if (!Array.isArray(setCookieHeaders)) {
        throw new Error('Expected set-cookie headers to be an array');
      }

      const csrfCookie = setCookieHeaders.find((cookie: string) =>
        cookie.startsWith(`${env.AUTH_CSRF_COOKIE_NAME}=`),
      );

      expect(csrfCookie).toBeDefined();
      expect(csrfCookie).toContain('Path=/auth');
      expect(csrfCookie).toContain('SameSite=Strict');
      expect(csrfCookie).not.toContain('HttpOnly');
    });
  });
});
