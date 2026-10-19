import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { errorMiddleware } from '../../common/middleware/error.middleware.js';
import { requireAuth } from '../auth/middleware/auth.middleware.js';
import { signAccessToken, verifyAccessToken } from '../auth/utils/jwt.js';
import { DriverController } from '../rides/controllers/driver.controller.js';
import type { DriverService } from '../rides/services/driver.service.js';
import type { RideService } from '../rides/services/ride.service.js';
import type { DriverDocumentStorageService } from '../rides/services/driver-document-storage.service.js';
import type { UserController } from '../users/controllers/user.controller.js';
import type { PostgresProviderOperationsRepository } from '../providers/repositories/provider-operations.repository.js';
import { createTestOnboardingRouter, issueTestOnboardingToken } from './router.js';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../infrastructure/database/postgres.js', () => ({ pool: db }));
const prior = { enabled: env.DRIVER_TEST_ONBOARDING_ENABLED, node: env.NODE_ENV };
beforeEach(() => {
  env.DRIVER_TEST_ONBOARDING_ENABLED = 'true';
  env.NODE_ENV = 'test';
  db.query.mockImplementation(async (_sql: string, params: string[]) => ({
    rowCount: 1,
    rows: [{ id: params[0] }],
  }));
});
afterEach(() => {
  env.DRIVER_TEST_ONBOARDING_ENABLED = prior.enabled;
  env.NODE_ENV = prior.node;
  vi.clearAllMocks();
});

function app() {
  const saved = vi.fn(async (id, data) => ({ id: randomUUID(), userId: id, ...data }));
  const driver = new DriverController(
    { upsertProfile: saved } as unknown as DriverService,
    {} as RideService,
    {} as DriverDocumentStorageService,
  );
  const user = {
    getById: (req: Request, res: Response) =>
      res.json({ success: true, data: { id: req.params.id } }),
    update: (_req: Request, res: Response) => res.json({ success: true, data: {} }),
  } as unknown as UserController;
  const server = express();
  server.use(express.json());
  server.use(
    '/driver-test-onboarding',
    createTestOnboardingRouter(driver, user, {} as PostgresProviderOperationsRepository),
  );
  server.get('/normal', requireAuth, (_req, res) => res.sendStatus(200));
  server.use(errorMiddleware);
  return { server, saved };
}
const prefix = '/driver-test-onboarding';
describe('local-only temporary driver onboarding boundary', () => {
  it('blocks disabled sessions and does not create identities', async () => {
    env.DRIVER_TEST_ONBOARDING_ENABLED = 'false';
    const { server } = app();
    expect(
      (
        await request(server)
          .post(prefix + '/sessions')
          .send({})
      ).status,
    ).toBe(404);
    expect((await request(server).get(prefix + '/capabilities')).body.data.enabled).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each(['production', 'staging'] as const)('cannot be enabled in %s', async (mode) => {
    env.NODE_ENV = mode;
    const { server } = app();
    expect(
      (
        await request(server)
          .post(prefix + '/sessions')
          .send({})
      ).status,
    ).toBe(404);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('creates a fresh server-owned identity and a token unusable by normal auth', async () => {
    const { server } = app();
    const response = await request(server)
      .post(prefix + '/sessions')
      .send({});
    expect(response.status).toBe(201);
    const { userId, sessionToken } = response.body.data;
    expect(userId).toMatch(/^[a-f0-9-]{36}$/);
    expect(db.query.mock.calls[0]?.[1]).toEqual([userId]);
    await expect(verifyAccessToken(sessionToken)).rejects.toThrow();
    expect(
      (await request(server).get('/normal').auth(sessionToken, { type: 'bearer' })).status,
    ).toBe(401);
    expect(
      (
        await request(server)
          .post(prefix + '/sessions')
          .send({ userId })
      ).status,
    ).toBe(400);
  });
  it('allows only its own account and rejects identity/role/contact changes', async () => {
    const { server } = app();
    const id = randomUUID();
    const token = await issueTestOnboardingToken(id);
    expect(
      (await request(server).get(`${prefix}/users/${id}`).auth(token, { type: 'bearer' })).status,
    ).toBe(200);
    expect(
      (await request(server).get(`${prefix}/users/${randomUUID()}`).auth(token, { type: 'bearer' }))
        .status,
    ).toBe(403);
    for (const body of [
      { role: 'admin' },
      { email: 'new@example.invalid' },
      { phone: '+918888888888' },
    ])
      expect(
        (
          await request(server)
            .patch(`${prefix}/users/${id}`)
            .auth(token, { type: 'bearer' })
            .send(body)
        ).status,
      ).toBe(400);
  });
  it('reuses profile validation and binds persistence to the session identity', async () => {
    const { server, saved } = app();
    const id = randomUUID();
    const token = await issueTestOnboardingToken(id);
    expect(
      (
        await request(server)
          .post(prefix + '/rides/driver/profile')
          .auth(token, { type: 'bearer' })
          .send({ licenseNumber: '', licenseExpiry: '2000-01-01' })
      ).status,
    ).toBe(400);
    expect(saved).not.toHaveBeenCalled();
    expect(
      (
        await request(server)
          .post(prefix + '/rides/driver/profile')
          .auth(token, { type: 'bearer' })
          .send({
            licenseNumber: 'LOCAL-TEST-ONLY',
            licenseExpiry: '2099-12-31',
            userId: randomUUID(),
          })
      ).status,
    ).toBe(400);
    const body = { licenseNumber: 'LOCAL-TEST-ONLY', licenseExpiry: '2099-12-31' };
    expect(
      (
        await request(server)
          .post(prefix + '/rides/driver/profile')
          .auth(token, { type: 'bearer' })
          .send(body)
      ).status,
    ).toBe(200);
    expect(saved).toHaveBeenCalledWith(id, body);
  });
  it('rejects normal tokens, missing, expired, and unavailable temporary identities', async () => {
    const { server } = app();
    const id = randomUUID();
    const normal = await signAccessToken({ sub: id, role: 'admin', type: 'access' });
    for (const token of ['invalid', normal, await issueTestOnboardingToken(id, '-1s')])
      expect(
        (await request(server).get(`${prefix}/users/${id}`).auth(token, { type: 'bearer' })).status,
      ).toBe(401);
    expect((await request(server).get(`${prefix}/users/${id}`)).status).toBe(401);
    db.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(
      (
        await request(server)
          .get(`${prefix}/users/${id}`)
          .auth(await issueTestOnboardingToken(id), { type: 'bearer' })
      ).status,
    ).toBe(401);
  });
  it('blocks general APIs, vehicle creation and unrelated approval targets', async () => {
    const { server } = app();
    const token = await issueTestOnboardingToken(randomUUID());
    for (const path of ['/vehicles', '/admin', '/rides/driver/availability', '/provider/tracking'])
      expect(
        (
          await request(server)
            .post(prefix + path)
            .auth(token, { type: 'bearer' })
            .send({})
        ).status,
      ).toBe(403);
    expect(
      (
        await request(server)
          .post(prefix + '/provider/approval-requests')
          .auth(token, { type: 'bearer' })
          .send({ targetType: 'vehicle' })
      ).status,
    ).toBe(403);
  });
  it('disabling the flag invalidates already issued sessions immediately', async () => {
    const { server } = app();
    const id = randomUUID();
    const token = await issueTestOnboardingToken(id);
    env.DRIVER_TEST_ONBOARDING_ENABLED = 'false';
    expect(
      (await request(server).get(`${prefix}/users/${id}`).auth(token, { type: 'bearer' })).status,
    ).toBe(404);
  });
});
