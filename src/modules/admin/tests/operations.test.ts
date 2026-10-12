import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminOperationsRepository,
  operationQuerySchema,
  operationSources,
} from '../repositories/operations.repository.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { createAdminOperationsRouter } from '../routes/operations.routes.js';
const userId = '550e8400-e29b-41d4-a716-446655440000';
function harness() {
  const repository = {
    authorize: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
    summary: vi.fn().mockResolvedValue({ rides: [], deliveries: [], capturedPayments: null }),
  };
  const app = express();
  app.use(
    '/admin/operations',
    createAdminOperationsRouter(repository as unknown as AdminOperationsRepository),
  );
  app.use(
    (
      error: { statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(error.statusCode ?? 400).json({ success: false }),
  );
  return { app, repository };
}
describe('admin operational visibility', () => {
  for (const role of ['user', 'driver', 'fleet_owner', 'driver_fleet_owner'])
    it(`rejects ${role}`, async () => {
      const { app, repository } = harness();
      const response = await request(app)
        .get('/admin/operations/rides')
        .set(
          'Authorization',
          'Bearer ' + (await signAccessToken({ sub: userId, role, type: 'access' })),
        );
      expect(response.status).toBe(403);
      expect(repository.list).not.toHaveBeenCalled();
    });
  it('rejects unauthenticated access', async () => {
    const { app } = harness();
    expect((await request(app).get('/admin/operations/rides')).status).toBe(401);
  });
  for (const module of Object.keys(operationSources))
    it(`validates and serves ${module}`, async () => {
      const { app, repository } = harness();
      const response = await request(app)
        .get('/admin/operations/' + module + '?page=2&pageSize=10')
        .set(
          'Authorization',
          'Bearer ' + (await signAccessToken({ sub: userId, role: 'super_admin', type: 'access' })),
        );
      expect(response.status).toBe(200);
      expect(repository.authorize).toHaveBeenCalledWith(userId, 'super_admin');
      expect(repository.list).toHaveBeenCalledWith(module, { page: 2, pageSize: 10 });
    });
  for (const module of ['payments', 'wallets', 'transactions', 'settlements', 'activity'])
    it(`blocks Admin from ${module}`, async () => {
      const { app, repository } = harness();
      expect(
        (
          await request(app)
            .get('/admin/operations/' + module)
            .set(
              'Authorization',
              'Bearer ' + (await signAccessToken({ sub: userId, role: 'admin', type: 'access' })),
            )
        ).status,
      ).toBe(403);
      expect(repository.list).not.toHaveBeenCalled();
    });
  it('does not permit revoked accounts', async () => {
    const { app, repository } = harness();
    repository.authorize.mockRejectedValue({ statusCode: 403 });
    expect(
      (
        await request(app)
          .get('/admin/operations/rides')
          .set(
            'Authorization',
            'Bearer ' + (await signAccessToken({ sub: userId, role: 'admin', type: 'access' })),
          )
      ).status,
    ).toBe(403);
    expect(repository.list).not.toHaveBeenCalled();
  });
  it('does not leak financial summaries to Admin', async () => {
    const { app, repository } = harness();
    expect(
      (
        await request(app)
          .get('/admin/operations/summary?from=2026-01-01&to=2026-02-01')
          .set(
            'Authorization',
            'Bearer ' + (await signAccessToken({ sub: userId, role: 'admin', type: 'access' })),
          )
      ).status,
    ).toBe(200);
    expect(repository.summary).toHaveBeenCalledWith('2026-01-01', '2026-02-01', false);
  });
  for (const query of [
    'status=NOT_A_STATUS',
    'page=0',
    'pageSize=101',
    'from=2026-02-02&to=2026-01-01',
    'unknown=true',
  ])
    it(`rejects invalid ${query}`, async () => {
      const { app, repository } = harness();
      expect(
        (
          await request(app)
            .get('/admin/operations/rides?' + query)
            .set(
              'Authorization',
              'Bearer ' + (await signAccessToken({ sub: userId, role: 'admin', type: 'access' })),
            )
        ).status,
      ).toBe(400);
      expect(repository.list).not.toHaveBeenCalled();
    });
  it('parameterizes filters and preserves empty-page totals', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ items: [], total: 40 }] });
    const repository = new AdminOperationsRepository({ query } as never);
    expect(
      await repository.list(
        'rides',
        operationQuerySchema.parse({
          page: 3,
          pageSize: 25,
          search: "'; DROP TABLE users; --",
          from: '2026-01-01',
        }),
      ),
    ).toEqual({ items: [], total: 40, page: 3, pageSize: 25 });
    expect(query.mock.calls[0]![0]).not.toContain('DROP TABLE');
    expect(query.mock.calls[0]![1]).toEqual(["%'; DROP TABLE users; --%", '2026-01-01', 25, 50]);
  });
  it('all explicit projections exclude security credentials and private payloads', () => {
    for (const source of Object.values(operationSources))
      expect(source.columns).not.toMatch(
        /\b(pin|password|payload|account_number_encrypted|idempotency_key|provider_reference)\b/,
      );
  });
});
