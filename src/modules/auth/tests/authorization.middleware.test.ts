import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  requireFleetFinancialContext,
  requireRoles,
} from '../middleware/authorization.middleware.js';
import { signAccessToken } from '../utils/jwt.js';

function createApp() {
  const app = express();

  app.get('/admin', requireAuth, requireRoles('admin', 'super_admin'), (req, res) => {
    res.json({
      success: true,
      data: req.auth,
    });
  });

  app.use(errorMiddleware);

  return app;
}

async function createToken(role: string) {
  return signAccessToken({
    sub: '00000000-0000-0000-0000-000000000001',
    role,
    type: 'access',
  });
}

describe('requireRoles', () => {
  it('rejects unauthenticated requests', async () => {
    const app = createApp();

    const response = await request(app).get('/admin');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects a user with an unauthorized role', async () => {
    const app = createApp();
    const token = await createToken('customer');

    const response = await request(app).get('/admin').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      },
    });
  });

  it('allows an admin', async () => {
    const app = createApp();
    const token = await createToken('admin');

    const response = await request(app).get('/admin').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('admin');
  });

  it('allows a super admin', async () => {
    const app = createApp();
    const token = await createToken('super_admin');

    const response = await request(app).get('/admin').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('super_admin');
  });
});

describe('Fleet financial context', () => {
  it.each([
    ['driver', undefined, 403],
    ['driver', 'fleet_owner', 403],
    ['customer', 'fleet_owner', 403],
    ['driver_fleet_owner', undefined, 403],
    ['driver_fleet_owner', 'driver', 403],
    ['driver_fleet_owner', 'fleet_owner', 200],
    ['fleet_owner', undefined, 200],
  ] as const)('enforces role %s and mode %s', async (role, mode, status) => {
    const app = express();
    app.get('/finance', requireAuth, requireFleetFinancialContext(), (_req, res) =>
      res.json({ ok: true }),
    );
    app.use(errorMiddleware);
    const req = request(app)
      .get('/finance')
      .set('Authorization', 'Bearer ' + (await createToken(role)));
    if (mode) req.set('X-Provider-Mode', mode);
    expect((await req).status).toBe(status);
  });
});
