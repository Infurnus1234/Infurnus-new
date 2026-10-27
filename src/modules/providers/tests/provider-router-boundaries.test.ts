import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireProvider } from '../../auth/middleware/authorization.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { createProviderFinanceRouter } from '../routes/provider-finance.routes.js';
import { createRoleEnrolmentRouter } from '../routes/role-enrolment.routes.js';
import type { PostgresProviderFinanceRepository } from '../repositories/provider-finance.repository.js';
import type { RoleEnrolmentRepository } from '../repositories/role-enrolment.repository.js';
function setup() {
  const finance = {
    wallet: vi.fn(async () => ({ balancePaise: '0' })),
    payouts: vi.fn(async () => []),
    requestPayout: vi.fn(async () => ({ id: 'payout' })),
  };
  const enrolment = {
    state: vi.fn(async (_id: string, role: string) => ({ role, dashboardAccessible: true })),
  };
  const app = express();
  app.use(express.json());
  // Match the real shared prefix and finance-before-operations mount order.
  app.use(
    '/provider',
    createProviderFinanceRouter(finance as unknown as PostgresProviderFinanceRepository),
  );
  app.use(
    '/provider',
    requireAuth,
    requireProvider(),
    createRoleEnrolmentRouter(enrolment as unknown as RoleEnrolmentRepository),
  );
  app.use(errorMiddleware);
  return { app, finance, enrolment };
}
const subject = '11111111-1111-4111-8111-111111111111';
describe('shared provider router authorization boundaries', () => {
  for (const role of ['driver', 'driver_fleet_owner', 'fleet_owner'] as const) {
    it(`${role} can restore enrolment without entering financial routes`, async () => {
      const { app, finance, enrolment } = setup();
      const token = await signAccessToken({ sub: subject, role, type: 'access' });
      const response = await request(app)
        .get('/provider/enrolment')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Provider-Mode', 'driver');
      expect(response.status).toBe(200);
      expect(response.body.data.role).toBe(role);
      expect(enrolment.state).toHaveBeenCalledOnce();
      expect(finance.wallet).not.toHaveBeenCalled();
    });
  }
  for (const path of ['/wallet', '/payouts']) {
    for (const role of ['driver', 'driver_fleet_owner'] as const) {
      it(`${role} in Driver mode is still denied ${path}`, async () => {
        const { app, finance } = setup();
        const token = await signAccessToken({ sub: subject, role, type: 'access' });
        expect(
          (
            await request(app)
              .get('/provider' + path)
              .set('Authorization', `Bearer ${token}`)
              .set('X-Provider-Mode', 'driver')
          ).status,
        ).toBe(403);
        expect(finance.wallet).not.toHaveBeenCalled();
        expect(finance.payouts).not.toHaveBeenCalled();
      });
    }
    for (const role of ['fleet_owner', 'driver_fleet_owner'] as const) {
      it(`${role} in Fleet mode can read ${path}`, async () => {
        const { app } = setup();
        const token = await signAccessToken({ sub: subject, role, type: 'access' });
        expect(
          (
            await request(app)
              .get('/provider' + path)
              .set('Authorization', `Bearer ${token}`)
              .set('X-Provider-Mode', 'fleet_owner')
          ).status,
        ).toBe(200);
      });
    }
    it(`unauthenticated ${path} remains denied`, async () => {
      expect((await request(setup().app).get('/provider' + path)).status).toBe(401);
    });
  }
  it('Driver cannot create payouts and customer cannot read provider enrolment', async () => {
    const { app, finance, enrolment } = setup();
    const driver = await signAccessToken({ sub: subject, role: 'driver', type: 'access' });
    expect(
      (
        await request(app)
          .post('/provider/payouts')
          .set('Authorization', `Bearer ${driver}`)
          .send({ amountPaise: 100, idempotencyKey: 'denied' })
      ).status,
    ).toBe(403);
    const customer = await signAccessToken({ sub: subject, role: 'customer', type: 'access' });
    expect(
      (await request(app).get('/provider/enrolment').set('Authorization', `Bearer ${customer}`))
        .status,
    ).toBe(403);
    expect(finance.requestPayout).not.toHaveBeenCalled();
    expect(enrolment.state).not.toHaveBeenCalled();
  });
});
