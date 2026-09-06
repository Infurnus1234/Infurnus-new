import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { clearRefreshTokenCookie, setRefreshTokenCookie } from '../utils/refresh-cookie.js';
import { clearCsrfTokenCookie, setCsrfTokenCookie } from '../utils/csrf-cookie.js';

function createMockResponse(): Response {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response;
}

describe('Refresh cookie utilities', () => {
  it('sets the refresh token with secure cookie attributes', () => {
    const response = createMockResponse();

    setRefreshTokenCookie(response, 'refresh-token');

    expect(response.cookie).toHaveBeenCalledWith(env.AUTH_REFRESH_COOKIE_NAME, 'refresh-token', {
      httpOnly: true,
      secure: env.AUTH_REFRESH_COOKIE_SECURE,
      sameSite: env.AUTH_REFRESH_COOKIE_SAME_SITE,
      path: '/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  it('clears the refresh token with matching cookie attributes', () => {
    const response = createMockResponse();

    clearRefreshTokenCookie(response);

    expect(response.clearCookie).toHaveBeenCalledWith(env.AUTH_REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: env.AUTH_REFRESH_COOKIE_SECURE,
      sameSite: env.AUTH_REFRESH_COOKIE_SAME_SITE,
      path: '/auth',
    });
  });
});

describe('CSRF cookie utilities', () => {
  it('sets the CSRF token as a readable cookie', () => {
    const response = createMockResponse();

    setCsrfTokenCookie(response, 'csrf-token');

    expect(response.cookie).toHaveBeenCalledWith(env.AUTH_CSRF_COOKIE_NAME, 'csrf-token', {
      httpOnly: false,
      secure: env.AUTH_CSRF_COOKIE_SECURE,
      sameSite: env.AUTH_CSRF_COOKIE_SAME_SITE,
      path: '/auth',
    });
  });

  it('clears the CSRF token with matching cookie attributes', () => {
    const response = createMockResponse();

    clearCsrfTokenCookie(response);

    expect(response.clearCookie).toHaveBeenCalledWith(env.AUTH_CSRF_COOKIE_NAME, {
      httpOnly: false,
      secure: env.AUTH_CSRF_COOKIE_SECURE,
      sameSite: env.AUTH_CSRF_COOKIE_SAME_SITE,
      path: '/auth',
    });
  });
});
