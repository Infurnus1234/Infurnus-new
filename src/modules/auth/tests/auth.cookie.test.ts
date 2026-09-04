import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import type { AuthControllerDependencies } from '../controllers/auth.controller.js';

const refreshToken = 'test-refresh-token';

const mockHandlers = {
  signup: vi.fn((_req, res) => {
    res.status(201).json({
      success: true,
      data: {
        signupId: 'signup-id',
        contactType: 'email',
        expiresAt: new Date().toISOString(),
      },
    });
  }),

  verifySignup: vi.fn((_req, res) => {
    res.cookie('infurnus_refresh_token', refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      data: {
        userId: 'user-id',
        accessToken: 'access-token',
        expiresAt: new Date().toISOString(),
      },
    });
  }),

  resendSignupOtp: vi.fn((_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        signupId: 'signup-id',
        contactType: 'email',
        expiresAt: new Date().toISOString(),
      },
    });
  }),

  login: vi.fn((_req, res) => {
    res.cookie('infurnus_refresh_token', refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      data: {
        userId: 'user-id',
        accessToken: 'access-token',
        expiresAt: new Date().toISOString(),
      },
    });
  }),

  refresh: vi.fn((_req, res) => {
    res.cookie('infurnus_refresh_token', 'rotated-refresh-token', {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      data: {
        accessToken: 'new-access-token',
        expiresAt: new Date().toISOString(),
      },
    });
  }),

  logout: vi.fn((_req, res) => {
    res.clearCookie('infurnus_refresh_token', {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/auth',
    });

    res.status(204).send();
  }),

  logoutAll: vi.fn((_req, res) => {
    res.clearCookie('infurnus_refresh_token', {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/auth',
    });

    res.status(204).send();
  }),
};

vi.mock('../controllers/auth.controller.js', () => ({
  createAuthHandlers: vi.fn(() => mockHandlers),
}));

const { createAuthRouter } = await import('../routes/auth.routes.js');

function createTestApp() {
  const app = express();

  app.use(express.json());

  app.use('/auth', createAuthRouter({} as AuthControllerDependencies));

  return app;
}

function getCookieHeader(response: request.Response): string {
  const cookies = response.headers['set-cookie'];

  expect(cookies).toBeDefined();

  return String(cookies);
}

describe('Auth cookie strategy', () => {
  it('stores the refresh token in an HttpOnly cookie during login', async () => {
    const app = createTestApp();

    const response = await request(app).post('/auth/login').send({
      email: 'test@example.com',
      password: 'StrongPassword123!',
    });

    expect(response.status).toBe(200);

    expect(response.body.data.refreshToken).toBeUndefined();

    const cookieHeader = getCookieHeader(response);

    expect(cookieHeader).toContain('infurnus_refresh_token=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Strict');
    expect(cookieHeader).toContain('Path=/auth');
  });

  it('stores the refresh token in an HttpOnly cookie after signup verification', async () => {
    const app = createTestApp();

    const response = await request(app).post('/auth/signup/verify').send({
      signupId: 'signup-id',
      otp: '123456',
    });

    expect(response.status).toBe(200);

    expect(response.body.data.refreshToken).toBeUndefined();

    const cookieHeader = getCookieHeader(response);

    expect(cookieHeader).toContain('infurnus_refresh_token=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Strict');
    expect(cookieHeader).toContain('Path=/auth');
  });

  it('does not expose the refresh token through the JSON response', async () => {
    const app = createTestApp();

    const response = await request(app).post('/auth/login').send({
      email: 'test@example.com',
      password: 'StrongPassword123!',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).not.toHaveProperty('refreshToken');
  });

  it('reads the refresh token from the cookie during refresh', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/auth/refresh')
      .set('Cookie', [`infurnus_refresh_token=${refreshToken}`]);

    expect(response.status).toBe(200);

    expect(mockHandlers.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not return the rotated refresh token in the refresh response', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/auth/refresh')
      .set('Cookie', [`infurnus_refresh_token=${refreshToken}`]);

    expect(response.status).toBe(200);
    expect(response.body.data.refreshToken).toBeUndefined();
  });

  it('clears the refresh cookie during logout', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/auth/logout')
      .set('Cookie', [`infurnus_refresh_token=${refreshToken}`]);

    expect(response.status).toBe(204);

    const cookieHeader = getCookieHeader(response);

    expect(cookieHeader).toContain('infurnus_refresh_token=');
    expect(cookieHeader).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Strict');
    expect(cookieHeader).toContain('Path=/auth');
  });
});
