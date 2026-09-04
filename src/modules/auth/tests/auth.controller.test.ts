import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../../../config/env.js';

import {
  createAuthHandlers,
  type AuthControllerDependencies,
} from '../controllers/auth.controller.js';

// ============================================================
// Mocks
// ============================================================

const mocks = vi.hoisted(() => ({
  rotate: vi.fn(),
  logout: vi.fn(),
  logoutAllForUser: vi.fn(),
  createAccessToken: vi.fn(),
  findIdentityById: vi.fn(),
}));

// ============================================================
// Helpers
// ============================================================

type RequestOverrides = Omit<Partial<Request>, 'auth'> & {
  auth?: Request['auth'] | undefined;
};

function createRequest(overrides: RequestOverrides = {}): Request {
  const getHeader = vi.fn((header: string): string | undefined => {
    if (header.toLowerCase() === 'user-agent') {
      return 'Mozilla/5.0';
    }

    return undefined;
  }) as unknown as Request['get'];

  return {
    headers: {},
    body: {},
    params: {},
    query: {},
    ip: '127.0.0.1',
    auth: undefined,
    get: getHeader,
    ...overrides,
  } as unknown as Request;
}

function createResponseMock() {
  const response = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return {
    response,
    cookie: response.cookie as ReturnType<typeof vi.fn>,
    clearCookie: response.clearCookie as ReturnType<typeof vi.fn>,
    status: response.status as ReturnType<typeof vi.fn>,
    json: response.json as ReturnType<typeof vi.fn>,
    send: response.send as ReturnType<typeof vi.fn>,
  };
}

function createNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

function createHandlers() {
  const dependencies = {
    signupService: {} as AuthControllerDependencies['signupService'],
    signupVerificationService: {} as AuthControllerDependencies['signupVerificationService'],
    otpResendService: {} as AuthControllerDependencies['otpResendService'],
    loginService: {} as AuthControllerDependencies['loginService'],

    refreshTokenService: {
      rotate: mocks.rotate,
    } as unknown as AuthControllerDependencies['refreshTokenService'],

    logoutService: {
      logout: mocks.logout,
      logoutAllForUser: mocks.logoutAllForUser,
    } as unknown as AuthControllerDependencies['logoutService'],

    tokenService: {
      createAccessToken: mocks.createAccessToken,
    } as unknown as AuthControllerDependencies['tokenService'],

    authUserRepository: {
      findIdentityById: mocks.findIdentityById,
    } as unknown as AuthControllerDependencies['authUserRepository'],
  } as AuthControllerDependencies;

  return createAuthHandlers(dependencies);
}

// ============================================================
// Test Suite
// ============================================================

describe('Auth Controller', () => {
  let handlers: ReturnType<typeof createAuthHandlers>;

  beforeEach(() => {
    vi.clearAllMocks();

    handlers = createHandlers();
  });

  // ==========================================================
  // refresh
  // ==========================================================

  describe('refresh', () => {
    it('rotates the refresh token and returns a new access token', async () => {
      const refreshToken = 'old-refresh-token';

      const userId = '550e8400-e29b-41d4-a716-446655440000';

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      mocks.rotate.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        refreshTokenId: 'refresh-token-id',
        familyId: 'family-id',
        userId,
        expiresAt,
      });

      mocks.findIdentityById.mockResolvedValue({
        id: userId,
        role: 'customer',
        status: 'active',
      });

      mocks.createAccessToken.mockResolvedValue('new-access-token');

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
      });

      const { response, status, json, cookie } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(next).not.toHaveBeenCalled();

      expect(mocks.rotate).toHaveBeenCalledTimes(1);

      expect(mocks.rotate).toHaveBeenCalledWith(refreshToken, {
        userAgent: 'Mozilla/5.0',
        ipAddress: '127.0.0.1',
      });

      expect(mocks.findIdentityById).toHaveBeenCalledTimes(1);

      expect(mocks.findIdentityById).toHaveBeenCalledWith(userId);

      expect(mocks.createAccessToken).toHaveBeenCalledTimes(1);

      expect(mocks.createAccessToken).toHaveBeenCalledWith({
        userId,
        role: 'customer',
      });

      expect(cookie).toHaveBeenCalledTimes(1);

      expect(cookie).toHaveBeenCalledWith(
        env.AUTH_REFRESH_COOKIE_NAME,
        'new-refresh-token',
        expect.any(Object),
      );

      expect(status).toHaveBeenCalledWith(200);

      expect(json).toHaveBeenCalledWith({
        success: true,
        data: {
          accessToken: 'new-access-token',
          expiresAt,
        },
      });
    });

    it('passes the request user-agent and IP address to refresh rotation', async () => {
      const refreshToken = 'refresh-token';

      const userId = '550e8400-e29b-41d4-a716-446655440001';

      const getHeader = vi.fn((header: string): string | undefined => {
        if (header.toLowerCase() === 'user-agent') {
          return 'Test-Agent';
        }

        return undefined;
      }) as unknown as Request['get'];

      mocks.rotate.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        refreshTokenId: 'token-id',
        familyId: 'family-id',
        userId,
        expiresAt: new Date(),
      });

      mocks.findIdentityById.mockResolvedValue({
        id: userId,
        role: 'customer',
        status: 'active',
      });

      mocks.createAccessToken.mockResolvedValue('access-token');

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
        ip: '192.168.1.10',
        get: getHeader,
      });

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(mocks.rotate).toHaveBeenCalledTimes(1);

      expect(mocks.rotate).toHaveBeenCalledWith(refreshToken, {
        userAgent: 'Test-Agent',
        ipAddress: '192.168.1.10',
      });

      expect(mocks.findIdentityById).toHaveBeenCalledWith(userId);

      expect(next).not.toHaveBeenCalled();
    });

    it('uses the current role returned by the user identity repository', async () => {
      const refreshToken = 'refresh-token';

      const userId = '550e8400-e29b-41d4-a716-446655440002';

      mocks.rotate.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        refreshTokenId: 'token-id',
        familyId: 'family-id',
        userId,
        expiresAt: new Date(),
      });

      mocks.findIdentityById.mockResolvedValue({
        id: userId,
        role: 'driver',
        status: 'active',
      });

      mocks.createAccessToken.mockResolvedValue('driver-access-token');

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(mocks.findIdentityById).toHaveBeenCalledWith(userId);

      expect(mocks.createAccessToken).toHaveBeenCalledTimes(1);

      expect(mocks.createAccessToken).toHaveBeenCalledWith({
        userId,
        role: 'driver',
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a missing refresh token', async () => {
      const req = createRequest();

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(mocks.rotate).not.toHaveBeenCalled();

      expect(mocks.findIdentityById).not.toHaveBeenCalled();

      expect(mocks.createAccessToken).not.toHaveBeenCalled();

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_REFRESH_TOKEN',
          statusCode: 401,
        }),
      );
    });

    it('rejects an empty refresh token cookie', async () => {
      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: '',
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(mocks.rotate).not.toHaveBeenCalled();

      expect(mocks.findIdentityById).not.toHaveBeenCalled();

      expect(mocks.createAccessToken).not.toHaveBeenCalled();

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_REFRESH_TOKEN',
          statusCode: 401,
        }),
      );
    });

    it('passes refresh service errors to error middleware', async () => {
      const refreshToken = 'refresh-token';

      const error = new Error('Refresh failed');

      mocks.rotate.mockRejectedValue(error);

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(mocks.rotate).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(error);

      expect(mocks.findIdentityById).not.toHaveBeenCalled();

      expect(mocks.createAccessToken).not.toHaveBeenCalled();
    });

    it('passes user identity repository errors to error middleware', async () => {
      const refreshToken = 'refresh-token';

      const userId = '550e8400-e29b-41d4-a716-446655440003';

      const error = new Error('User lookup failed');

      mocks.rotate.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        refreshTokenId: 'token-id',
        familyId: 'family-id',
        userId,
        expiresAt: new Date(),
      });

      mocks.findIdentityById.mockRejectedValue(error);

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(mocks.rotate).toHaveBeenCalledTimes(1);

      expect(mocks.findIdentityById).toHaveBeenCalledWith(userId);

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(error);

      expect(mocks.createAccessToken).not.toHaveBeenCalled();
    });

    it('rejects refresh for a non-active account', async () => {
      const refreshToken = 'refresh-token';

      const userId = '550e8400-e29b-41d4-a716-446655440007';

      mocks.rotate.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        refreshTokenId: 'token-id',
        familyId: 'family-id',
        userId,
        expiresAt: new Date(),
      });

      mocks.findIdentityById.mockResolvedValue({
        id: userId,
        role: 'customer',
        status: 'suspended',
      });

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(mocks.rotate).toHaveBeenCalledTimes(1);

      expect(mocks.findIdentityById).toHaveBeenCalledWith(userId);

      expect(mocks.createAccessToken).not.toHaveBeenCalled();

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'ACCOUNT_NOT_ACTIVE',
          statusCode: 401,
        }),
      );
    });

    it('rejects refresh when the user identity does not exist', async () => {
      const refreshToken = 'refresh-token';

      const userId = '550e8400-e29b-41d4-a716-446655440008';

      mocks.rotate.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        refreshTokenId: 'token-id',
        familyId: 'family-id',
        userId,
        expiresAt: new Date(),
      });

      mocks.findIdentityById.mockResolvedValue(null);

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(mocks.findIdentityById).toHaveBeenCalledWith(userId);

      expect(mocks.createAccessToken).not.toHaveBeenCalled();

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_USER',
          statusCode: 401,
        }),
      );
    });

    it('passes token service errors to error middleware', async () => {
      const refreshToken = 'refresh-token';

      const userId = '550e8400-e29b-41d4-a716-446655440009';

      const error = new Error('Access token creation failed');

      mocks.rotate.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        refreshTokenId: 'token-id',
        familyId: 'family-id',
        userId,
        expiresAt: new Date(),
      });

      mocks.findIdentityById.mockResolvedValue({
        id: userId,
        role: 'customer',
        status: 'active',
      });

      mocks.createAccessToken.mockRejectedValue(error);

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.refresh(req, response, next);

      expect(mocks.createAccessToken).toHaveBeenCalledWith({
        userId,
        role: 'customer',
      });

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ==========================================================
  // logout
  // ==========================================================

  describe('logout', () => {
    it('revokes the supplied refresh token, clears the cookie, and returns 204', async () => {
      const refreshToken = 'refresh-token';

      mocks.logout.mockResolvedValue(undefined);

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
      });

      const { response, clearCookie, status, send } = createResponseMock();

      const next = createNext();

      await handlers.logout(req, response, next);

      expect(next).not.toHaveBeenCalled();

      expect(mocks.logout).toHaveBeenCalledTimes(1);

      expect(mocks.logout).toHaveBeenCalledWith(refreshToken);

      expect(clearCookie).toHaveBeenCalledTimes(1);

      expect(clearCookie).toHaveBeenCalledWith(env.AUTH_REFRESH_COOKIE_NAME, expect.any(Object));

      expect(status).toHaveBeenCalledWith(204);

      expect(send).toHaveBeenCalledWith();
    });

    it('rejects when no refresh token cookie is present', async () => {
      const req = createRequest();

      const { response, clearCookie } = createResponseMock();

      const next = createNext();

      await handlers.logout(req, response, next);

      expect(mocks.logout).not.toHaveBeenCalled();

      expect(clearCookie).not.toHaveBeenCalled();

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_REFRESH_TOKEN',
          statusCode: 401,
        }),
      );
    });

    it('passes logout service errors to error middleware', async () => {
      const refreshToken = 'refresh-token';

      const error = new Error('Logout failed');

      mocks.logout.mockRejectedValue(error);

      const req = createRequest({
        cookies: {
          [env.AUTH_REFRESH_COOKIE_NAME]: refreshToken,
        },
      });

      const { response, clearCookie } = createResponseMock();

      const next = createNext();

      await handlers.logout(req, response, next);

      expect(mocks.logout).toHaveBeenCalledWith(refreshToken);

      expect(clearCookie).not.toHaveBeenCalled();

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ==========================================================
  // logoutAll
  // ==========================================================

  describe('logoutAll', () => {
    it('revokes all sessions for the authenticated user, clears the cookie, and returns 204', async () => {
      const userId = '550e8400-e29b-41d4-a716-446655440010';

      mocks.logoutAllForUser.mockResolvedValue(undefined);

      const req = createRequest({
        auth: {
          userId,
          role: 'customer',
        },
      });

      const { response, clearCookie, status, send } = createResponseMock();

      const next = createNext();

      await handlers.logoutAll(req, response, next);

      expect(next).not.toHaveBeenCalled();

      expect(mocks.logoutAllForUser).toHaveBeenCalledTimes(1);

      expect(mocks.logoutAllForUser).toHaveBeenCalledWith(userId);

      expect(clearCookie).toHaveBeenCalledTimes(1);

      expect(clearCookie).toHaveBeenCalledWith(env.AUTH_REFRESH_COOKIE_NAME, expect.any(Object));

      expect(status).toHaveBeenCalledWith(204);

      expect(send).toHaveBeenCalledWith();
    });

    it('rejects an unauthenticated request', async () => {
      const req = createRequest({
        auth: undefined,
      });

      const { response } = createResponseMock();

      const next = createNext();

      await handlers.logoutAll(req, response, next);

      expect(mocks.logoutAllForUser).not.toHaveBeenCalled();

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'AUTHENTICATION_REQUIRED',
          statusCode: 401,
        }),
      );
    });

    it('passes logout-all service errors to error middleware', async () => {
      const userId = '550e8400-e29b-41d4-a716-446655440011';

      const error = new Error('Logout all failed');

      mocks.logoutAllForUser.mockRejectedValue(error);

      const req = createRequest({
        auth: {
          userId,
          role: 'customer',
        },
      });

      const { response, clearCookie } = createResponseMock();

      const next = createNext();

      await handlers.logoutAll(req, response, next);

      expect(mocks.logoutAllForUser).toHaveBeenCalledWith(userId);

      expect(clearCookie).not.toHaveBeenCalled();

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
