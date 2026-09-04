import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { signAccessToken } from '../utils/jwt.js';

function createApp() {
  const app = express();

  app.get('/protected', requireAuth, (req, res) => {
    res.json({
      success: true,
      data: req.auth,
    });
  });

  app.use(errorMiddleware);

  return app;
}

describe('requireAuth', () => {
  it('rejects requests without authorization', async () => {
    const app = createApp();

    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required',
      },
    });
  });

  it('rejects malformed authorization headers', async () => {
    const app = createApp();

    const response = await request(app).get('/protected').set('Authorization', 'Basic token');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_AUTHORIZATION_HEADER');
  });

  it('rejects invalid access tokens', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('authenticates a valid access token', async () => {
    const app = createApp();

    const token = await signAccessToken({
      sub: '00000000-0000-0000-0000-000000000001',
      role: 'customer',
      type: 'access',
    });

    const response = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        userId: '00000000-0000-0000-0000-000000000001',
        role: 'customer',
      },
    });
  });
});
