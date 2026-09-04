import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

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
// Refresh Token Service
// ============================================================

vi.mock('../services/refresh-token.service.js', () => ({
  RefreshTokenService: class {
    async rotate(...args: Parameters<typeof mocks.rotate>): Promise<unknown> {
      return mocks.rotate(...args);
    }
  },
}));

// ============================================================
// Logout Service
// ============================================================

vi.mock('../services/logout.service.js', () => ({
  LogoutService: class {
    async logout(...args: Parameters<typeof mocks.logout>): Promise<unknown> {
      return mocks.logout(...args);
    }

    async logoutAllForUser(...args: Parameters<typeof mocks.logoutAllForUser>): Promise<unknown> {
      return mocks.logoutAllForUser(...args);
    }
  },
}));

// ============================================================
// Token Service
// ============================================================

vi.mock('../services/token.service.js', () => ({
  TokenService: class {
    async createAccessToken(...args: Parameters<typeof mocks.createAccessToken>): Promise<unknown> {
      return mocks.createAccessToken(...args);
    }
  },
}));

// ============================================================
// Refresh Token Repository
// ============================================================

vi.mock('../repositories/refresh-token.repository.js', () => ({
  PostgresRefreshTokenRepository: class {},
}));

// ============================================================
// Auth User Repository
// ============================================================

vi.mock('../repositories/auth-user.repository.js', () => ({
  PostgresAuthUserRepository: class {
    async findIdentityById(...args: Parameters<typeof mocks.findIdentityById>): Promise<unknown> {
      return mocks.findIdentityById(...args);
    }
  },
}));

// ============================================================
// Controller
// ============================================================

import { logout, logoutAll, refresh } from '../controllers/auth.controller.js';

// ============================================================
// Response Mock
// ============================================================

function createResponseMock() {
  const json = vi.fn();
  const send = vi.fn();

  const status = vi.fn().mockReturnValue({
    json,
    send,
  });

  const response = {
    status,
    json,
    send,
  } as unknown as Response;

  return {
    response,
    status,
    json,
    send,
  };
}

// ============================================================
// Request Mock
// ============================================================

function createRequest(overrides: Partial<Request> = {}): Request {
  const getHeader = vi.fn((header: string): string | undefined => {
    if (header.toLowerCase() === 'user-agent') {
      return 'Mozilla/5.0';
    }

    return undefined;
  }) as unknown as Request['get'];

  return {
    body: {},
    ip: '127.0.0.1',
    auth: undefined,
    get: getHeader,
    ...overrides,
  } as unknown as Request;
}

// ============================================================
// Next Mock
// ============================================================

function createNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ============================================================
// Test Suite
// ============================================================

describe('Auth Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================
  // Refresh
  // ==========================================================

  describe('refresh', () => {
    it('rotates the refresh token and returns a new access token', async () => {
      const req = createRequest({
        body: {
          refreshToken: 'old-refresh-token',
        },
      });

      const { response, status, json } = createResponseMock();

      const next = createNext();

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

      await refresh(req, response, next);

      expect(next).not.toHaveBeenCalled();

      expect(mocks.rotate).toHaveBeenCalledTimes(1);

      expect(mocks.rotate).toHaveBeenCalledWith('old-refresh-token', {
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

      expect(status).toHaveBeenCalledWith(200);

      expect(json).toHaveBeenCalledWith({
        success: true,
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresAt,
        },
      });
    });

    it('passes the request user-agent and IP address to refresh rotation', async () => {
      const getHeader = vi.fn((header: string): string | undefined => {
        if (header.toLowerCase() === 'user-agent') {
          return 'Test-Agent';
        }

        return undefined;
      }) as unknown as Request['get'];

      const userId = '550e8400-e29b-41d4-a716-446655440001';

      const req = createRequest({
        body: {
          refreshToken: 'refresh-token',
        },
        ip: '192.168.1.10',
        get: getHeader,
      });

      const { response } = createResponseMock();

      const next = createNext();

      const expiresAt = new Date();

      mocks.rotate.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        refreshTokenId: 'token-id',
        familyId: 'family-id',
        userId,
        expiresAt,
      });

      mocks.findIdentityById.mockResolvedValue({
        id: userId,
        role: 'customer',
        status: 'active',
      });

      mocks.createAccessToken.mockResolvedValue('access-token');

      await refresh(req, response, next);

      expect(mocks.rotate).toHaveBeenCalledWith('refresh-token', {
        userAgent: 'Test-Agent',
        ipAddress: '192.168.1.10',
      });

      expect(mocks.findIdentityById).toHaveBeenCalledWith(userId);
    });

    it('uses the current role returned by the user identity repository', async () => {
      const req = createRequest({
        body: {
          refreshToken: 'refresh-token',
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      const userId = '550e8400-e29b-41d4-a716-446655440002';

      const expiresAt = new Date();

      mocks.rotate.mockResolvedValue({
        refreshToken: 'new-refresh-token',
        refreshTokenId: 'token-id',
        familyId: 'family-id',
        userId,
        expiresAt,
      });

      mocks.findIdentityById.mockResolvedValue({
        id: userId,
        role: 'driver',
        status: 'active',
      });

      mocks.createAccessToken.mockResolvedValue('driver-access-token');

      await refresh(req, response, next);

      expect(mocks.createAccessToken).toHaveBeenCalledWith({
        userId,
        role: 'driver',
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a missing refresh token', async () => {
      const req = createRequest({
        body: {},
      });

      const { response } = createResponseMock();

      const next = createNext();

      await refresh(req, response, next);

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

    it('rejects a non-string refresh token', async () => {
      const req = createRequest({
        body: {
          refreshToken: 12345,
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      await refresh(req, response, next);

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
      const req = createRequest({
        body: {
          refreshToken: 'refresh-token',
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      const error = new Error('Refresh failed');

      mocks.rotate.mockRejectedValue(error);

      await refresh(req, response, next);

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(error);

      expect(mocks.findIdentityById).not.toHaveBeenCalled();

      expect(mocks.createAccessToken).not.toHaveBeenCalled();
    });

    it('passes user identity repository errors to error middleware', async () => {
      const req = createRequest({
        body: {
          refreshToken: 'refresh-token',
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

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

      await refresh(req, response, next);

      expect(mocks.findIdentityById).toHaveBeenCalledWith(userId);

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(error);

      expect(mocks.createAccessToken).not.toHaveBeenCalled();
    });
  });

  // ==========================================================
  // Logout
  // ==========================================================

  describe('logout', () => {
    it('revokes the supplied refresh token and returns 204', async () => {
      const req = createRequest({
        body: {
          refreshToken: 'refresh-token',
        },
      });

      const { response, status, send } = createResponseMock();

      const next = createNext();

      mocks.logout.mockResolvedValue(undefined);

      await logout(req, response, next);

      expect(next).not.toHaveBeenCalled();

      expect(mocks.logout).toHaveBeenCalledTimes(1);

      expect(mocks.logout).toHaveBeenCalledWith('refresh-token');

      expect(status).toHaveBeenCalledWith(204);

      expect(send).toHaveBeenCalledWith();
    });

    it('rejects a missing refresh token', async () => {
      const req = createRequest({
        body: {},
      });

      const { response } = createResponseMock();

      const next = createNext();

      await logout(req, response, next);

      expect(mocks.logout).not.toHaveBeenCalled();

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_REFRESH_TOKEN',
          statusCode: 401,
        }),
      );
    });

    it('passes logout service errors to error middleware', async () => {
      const req = createRequest({
        body: {
          refreshToken: 'refresh-token',
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      const error = new Error('Logout failed');

      mocks.logout.mockRejectedValue(error);

      await logout(req, response, next);

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ==========================================================
  // Logout All
  // ==========================================================

  describe('logoutAll', () => {
    it('revokes all sessions for the authenticated user and returns 204', async () => {
      const userId = '550e8400-e29b-41d4-a716-446655440004';

      const req = createRequest({
        auth: {
          userId,
          role: 'customer',
        },
      });

      const { response, status, send } = createResponseMock();

      const next = createNext();

      mocks.logoutAllForUser.mockResolvedValue(undefined);

      await logoutAll(req, response, next);

      expect(next).not.toHaveBeenCalled();

      expect(mocks.logoutAllForUser).toHaveBeenCalledTimes(1);

      expect(mocks.logoutAllForUser).toHaveBeenCalledWith(userId);

      expect(status).toHaveBeenCalledWith(204);

      expect(send).toHaveBeenCalledWith();
    });

    it('rejects an unauthenticated request', async () => {
      const req = createRequest({
        auth: undefined,
      });

      const { response } = createResponseMock();

      const next = createNext();

      await logoutAll(req, response, next);

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
      const userId = '550e8400-e29b-41d4-a716-446655440005';

      const req = createRequest({
        auth: {
          userId,
          role: 'customer',
        },
      });

      const { response } = createResponseMock();

      const next = createNext();

      const error = new Error('Logout all failed');

      mocks.logoutAllForUser.mockRejectedValue(error);

      await logoutAll(req, response, next);

      expect(next).toHaveBeenCalledTimes(1);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
