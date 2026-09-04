import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthControllerDependencies } from '../controllers/auth.controller.js';

const mockHandlers = {
  signup: vi.fn((_req, res) => {
    res.status(201).json({
      success: true,
      data: { status: 'signup-ok' },
    });
  }),

  verifySignup: vi.fn((_req, res) => {
    res.status(200).json({
      success: true,
      data: { status: 'verify-ok' },
    });
  }),

  resendSignupOtp: vi.fn((_req, res) => {
    res.status(200).json({
      success: true,
      data: { status: 'resend-ok' },
    });
  }),

  login: vi.fn((_req, res) => {
    res.status(200).json({
      success: true,
      data: { status: 'login-ok' },
    });
  }),

  refresh: vi.fn((_req, res) => {
    res.status(200).json({
      success: true,
      data: { status: 'refresh-ok' },
    });
  }),

  logout: vi.fn((_req, res) => {
    res.status(204).send();
  }),

  logoutAll: vi.fn((_req, res) => {
    res.status(204).send();
  }),
};

vi.mock('../controllers/auth.controller.js', () => ({
  createAuthHandlers: vi.fn(() => mockHandlers),
}));

async function createTestApp() {
  vi.resetModules();

  const { createAuthRouter } = await import('../routes/auth.routes.js');

  const app = express();

  app.use(express.json());

  app.use('/auth', createAuthRouter({} as AuthControllerDependencies));

  return app;
}

describe('Auth route rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rate limits the signup route', async () => {
    const app = await createTestApp();

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app).post('/auth/signup').send({
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
          password: 'StrongPassword123!',
        }),
      ),
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);

    expect(responses.find((response) => response.status === 429)?.body).toEqual({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
    });
  });

  it('rate limits the signup verification route', async () => {
    const app = await createTestApp();

    const responses = await Promise.all(
      Array.from({ length: 11 }, () =>
        request(app).post('/auth/signup/verify').send({
          signupId: 'signup-id',
          otp: '123456',
        }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it('rate limits the signup resend route', async () => {
    const app = await createTestApp();

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app).post('/auth/signup/resend').send({
          signupId: 'signup-id',
        }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it('rate limits the login route', async () => {
    const app = await createTestApp();

    const responses = await Promise.all(
      Array.from({ length: 11 }, () =>
        request(app).post('/auth/login').send({
          email: 'test@example.com',
          password: 'StrongPassword123!',
        }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it('rate limits the refresh route', async () => {
    const app = await createTestApp();

    const responses = await Promise.all(
      Array.from({ length: 31 }, () =>
        request(app).post('/auth/refresh').send({
          refreshToken: 'refresh-token',
        }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(30);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it('rate limits the logout route', async () => {
    const app = await createTestApp();

    const responses = await Promise.all(
      Array.from({ length: 31 }, () =>
        request(app).post('/auth/logout').send({
          refreshToken: 'refresh-token',
        }),
      ),
    );

    expect(responses.filter((response) => response.status === 204)).toHaveLength(30);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it('rate limits the logout-all route', async () => {
    const app = await createTestApp();

    const responses = await Promise.all(
      Array.from({ length: 31 }, () =>
        request(app).post('/auth/logout-all').set('Authorization', 'Bearer invalid-token'),
      ),
    );

    expect(responses.filter((response) => response.status === 401)).toHaveLength(30);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it('executes the underlying handlers before their rate limits are exceeded', async () => {
    const app = await createTestApp();

    const response = await request(app).post('/auth/login').send({
      email: 'test@example.com',
      password: 'StrongPassword123!',
    });

    expect(response.status).toBe(200);
    expect(mockHandlers.login).toHaveBeenCalledTimes(1);
  });
});
