import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { administrativePermissionGate } from '../middleware/permission.middleware.js';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';

describe('public authentication with an expired previous access token', () => {
  for (const path of [
    '/auth/google',
    '/auth/login/verify',
    '/auth/signup',
    '/auth/signup/verify',
    '/auth/login/resend',
    '/auth/signup/resend',
    '/auth/forgot-password',
    '/auth/forgot-password/verify',
    '/auth/reset-password',
  ]) {
    it(`${path} reaches its own identity/challenge validation`, async () => {
      const identity = vi.fn(async () => {
        throw new Error('Must not authorize an Admin');
      });
      const app = express();
      app.use(administrativePermissionGate({ identity }));
      app.post(path, (_req, res) => res.status(400).json({ code: 'OWN_AUTH_VALIDATION' }));
      app.use(errorMiddleware);
      const result = await request(app).post(path).set('Authorization', 'Bearer expired-fixture');
      expect(result.status).toBe(400);
      expect(result.body.code).toBe('OWN_AUTH_VALIDATION');
      expect(identity).not.toHaveBeenCalled();
    });
  }
  for (const path of ['/auth/google/link', '/auth/change-password', '/admin/users']) {
    it(`${path} still rejects an invalid access token`, async () => {
      const app = express();
      app.use(
        administrativePermissionGate({
          identity: async () => {
            throw new Error('Denied');
          },
        }),
      );
      app.post(path, requireAuth, (_req, res) => res.json({ unexpected: true }));
      app.use(errorMiddleware);
      const result = await request(app).post(path).set('Authorization', 'Bearer expired-fixture');
      expect(result.status).toBe(401);
      expect(result.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    });
  }
});
