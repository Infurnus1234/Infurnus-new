import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PostgresSupportRepository } from '../repositories/support.repository.js';
import { SupportService } from '../services/support.service.js';
import { SupportController } from '../controllers/support.controller.js';
import { createSupportRouter } from '../routes/support.routes.js';
import { createAdminOperationsRouter } from '../../admin/routes/operations.routes.js';
import { AdminOperationsRepository } from '../../admin/repositories/operations.repository.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Support lifecycle on disposable PostgreSQL',
  () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const ids = {
      customer: randomUUID(),
      driver: randomUUID(),
      admin: randomUUID(),
      other: randomUUID(),
    };
    const repository = new PostgresSupportRepository(pool);
    const operations = new AdminOperationsRepository(pool);
    const app = express();
    app.use(express.json());
    app.use('/support', createSupportRouter(new SupportController(new SupportService(repository))));
    app.use('/admin/operations', createAdminOperationsRouter(operations));
    app.use(errorMiddleware);
    let safe = false;
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(url.hostname))
        throw Error('Disposable local database required');
      safe = true;
      for (const [role, id] of Object.entries(ids))
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role,status) VALUES($1,'TEST','Support',$2,$3,'active')",
          [id, `${id}@example.invalid`, role === 'other' ? 'customer' : role],
        );
    });
    afterAll(async () => {
      if (safe)
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [Object.values(ids)]);
      await pool.end();
    });
    const token = (role: keyof typeof ids) =>
      signAccessToken({
        sub: ids[role],
        role: role === 'other' ? 'customer' : role,
        type: 'access',
      });
    it.each(['customer', 'driver'] as const)(
      'creates, retrieves and administratively updates %s ticket with ownership and stale-edit protection',
      async (role) => {
        const authorization = `Bearer ${await token(role)}`;
        const created = await request(app)
          .post('/support/tickets')
          .set('authorization', authorization)
          .send({
            category: 'App',
            subject: 'TEST support issue',
            message: 'TEST_SAMPLE local request only',
          });
        expect(created.status).toBe(201);
        const id = created.body.data.id;
        expect(created.body.data).toMatchObject({ userId: ids[role], role, status: 'OPEN' });
        expect(
          (
            await request(app)
              .get(`/support/tickets/${id}`)
              .set('authorization', `Bearer ${await token('other')}`)
          ).status,
        ).toBe(404);
        expect((await request(app).get('/support/tickets')).status).toBe(401);
        expect(
          (
            await request(app)
              .patch(`/admin/operations/support/${id}/status`)
              .set('authorization', authorization)
              .send({ status: 'RESOLVED', expectedVersion: 1 })
          ).status,
        ).toBe(403);
        const admin = `Bearer ${await token('admin')}`;
        const listed = await request(app)
          .get(`/admin/operations/support?recordId=${id}`)
          .set('authorization', admin);
        expect(listed.status).toBe(200);
        expect(listed.body.data.items[0]).toMatchObject({ id, role, version: 1 });
        expect(
          (
            await request(app)
              .patch(`/admin/operations/support/${id}/status`)
              .set('authorization', admin)
              .send({ status: 'INVALID', expectedVersion: 1 })
          ).status,
        ).toBe(400);
        expect(
          (
            await request(app)
              .patch(`/admin/operations/support/${id}/status`)
              .set('authorization', admin)
              .send({ status: 'RESOLVED', expectedVersion: 1 })
          ).status,
        ).toBe(200);
        expect(
          (
            await request(app)
              .patch(`/admin/operations/support/${id}/status`)
              .set('authorization', admin)
              .send({ status: 'CLOSED', expectedVersion: 1 })
          ).status,
        ).toBe(409);
        expect(await repository.getTicketById(ids[role], id)).toMatchObject({ status: 'RESOLVED' });
        expect(await new PostgresSupportRepository(pool).listTickets(ids[role])).toEqual(
          expect.arrayContaining([expect.objectContaining({ id, status: 'RESOLVED' })]),
        );
      },
    );
  },
);
