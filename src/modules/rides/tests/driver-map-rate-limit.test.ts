import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { createRideRouter } from '../routes/ride.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { env } from '../../../config/env.js';

describe('Driver route reads and assignment protection', () => {
  it('allows routine route refreshes without consuming the assignment-code limit', async () => {
    const handler = (_req: express.Request, res: express.Response) =>
      res.json({ success: true, data: {} });
    const controllers = new Proxy({}, { get: () => handler });
    const app = express();
    app.use(express.json());
    app.use('/rides', createRideRouter(controllers as never, controllers as never));
    const token = await signAccessToken({ sub: randomUUID(), role: 'driver', type: 'access' });
    for (let i = 0; i < 11; i++) {
      const response = await request(app)
        .get('/rides/driver/rides/' + randomUUID() + '/map?includeRoute=true')
        .auth(token, { type: 'bearer' });
      expect(response.status, response.text).toBe(200);
    }
    for (let i = 0; i < 10; i++)
      expect(
        (
          await request(app)
            .post('/rides/driver/assignment/verify-code')
            .auth(token, { type: 'bearer' })
            .send({ code: 'TEST' })
        ).status,
      ).toBe(200);
    expect(
      (
        await request(app)
          .post('/rides/driver/assignment/verify-code')
          .auth(token, { type: 'bearer' })
          .send({ code: 'TEST' })
      ).status,
    ).toBe(429);
  });

  it('returns a structured map throttling error while retaining a bounded map rate', async () => {
    const handler = (_req: express.Request, res: express.Response) =>
      res.json({ success: true, data: {} });
    const controllers = new Proxy({}, { get: () => handler });
    const app = express();
    app.use('/rides', createRideRouter(controllers as never, controllers as never));
    const token = await signAccessToken({ sub: randomUUID(), role: 'driver', type: 'access' });
    for (let i = 0; i < env.MAP_RATE_LIMIT_MAX; i++)
      await request(app)
        .get('/rides/driver/rides/' + randomUUID() + '/map')
        .auth(token, { type: 'bearer' });
    const response = await request(app)
      .get('/rides/driver/rides/' + randomUUID() + '/map')
      .auth(token, { type: 'bearer' });
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('MAP_RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
  });
});
