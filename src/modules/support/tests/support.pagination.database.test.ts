import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { PostgresSupportRepository } from '../repositories/support.repository.js';
import { SupportService } from '../services/support.service.js';
import { SupportController } from '../controllers/support.controller.js';
import { createSupportRouter } from '../routes/support.routes.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'SUP-01/02 actual ticket persistence, ownership and page boundaries',
  () => {
    const owner = randomUUID(),
      other = randomUUID();
    const app = express();
    app.use(express.json());
    app.use(
      '/support',
      createSupportRouter(
        new SupportController(new SupportService(new PostgresSupportRepository(pool))),
      ),
    );
    app.use(errorMiddleware);
    let credential: string;
    beforeAll(async () => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Isolated owned test database required');
      for (const id of [owner, other])
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE','Support',$2,'driver')",
          [id, id + '@example.invalid'],
        );
      credential = await signAccessToken({ sub: owner, role: 'driver', type: 'access' });
    });
    it('round-trips 25 full-size records without a phantom next page, then finds the 26th without duplicates', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) {
        const result = await request(app)
          .post('/support/tickets')
          .set('Authorization', 'Bearer ' + credential)
          .send({ category: 'App', subject: 'T'.repeat(200), message: 'M'.repeat(5000) });
        expect(result.status).toBe(201);
        expect(result.body.data.status).toBe('OPEN');
        expect(result.body.data.userId).toBe(owner);
        ids.push(result.body.data.id);
      }
      const path = '/support/tickets?includePagination=true&pageSize=25';
      const first = await request(app)
        .get(path)
        .set('Authorization', 'Bearer ' + credential);
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(25);
      expect(first.body.pagination.hasNext).toBe(false);
      const created = await request(app)
        .post('/support/tickets')
        .set('Authorization', 'Bearer ' + credential)
        .send({
          category: 'App',
          subject: 'New isolated ticket',
          message: 'Saved and retrieved through actual services',
        });
      expect(created.status).toBe(201);
      const page1 = await request(app)
        .get(path)
        .set('Authorization', 'Bearer ' + credential);
      const page2 = await request(app)
        .get(path + '&page=2')
        .set('Authorization', 'Bearer ' + credential);
      expect(page1.body.pagination).toMatchObject({ page: 1, hasNext: true });
      expect(page2.body.pagination).toMatchObject({ page: 2, hasNext: false });
      expect(new Set([...page1.body.data, ...page2.body.data].map((x) => x.id)).size).toBe(26);
      const saved = await pool.query(
        'SELECT user_id,status,length(subject) AS subject_size,length(message) AS message_size FROM support_tickets WHERE id=$1',
        [ids[0]],
      );
      expect(saved.rows[0]).toMatchObject({
        user_id: owner,
        status: 'OPEN',
        subject_size: 200,
        message_size: 5000,
      });
      const legacy = await request(app)
        .get('/support/tickets')
        .set('Authorization', 'Bearer ' + credential);
      expect(Array.isArray(legacy.body.data)).toBe(true);
      expect(legacy.body.pagination).toBeUndefined();
      const unauthorized = await request(app)
        .get('/support/tickets/' + created.body.data.id)
        .set(
          'Authorization',
          'Bearer ' + (await signAccessToken({ sub: other, role: 'driver', type: 'access' })),
        );
      expect(unauthorized.status).toBe(404);
    });
    it.each([
      { subject: ' ', message: 'Valid description' },
      { subject: 'T'.repeat(201), message: 'Valid description' },
      { subject: 'Valid subject', message: ' ' },
      { subject: 'Valid subject', message: 'M'.repeat(5001) },
      { subject: 'Valid subject', message: 'Valid description', userId: other },
    ])('rejects invalid/forged ticket input %# without persisting it', async (input) => {
      const before = (
        await pool.query('SELECT count(*)::int AS n FROM support_tickets WHERE user_id=$1', [owner])
      ).rows[0].n;
      expect(
        (
          await request(app)
            .post('/support/tickets')
            .set('Authorization', 'Bearer ' + credential)
            .send({ category: 'App', ...input })
        ).status,
      ).toBe(400);
      expect(
        (
          await pool.query('SELECT count(*)::int AS n FROM support_tickets WHERE user_id=$1', [
            owner,
          ])
        ).rows[0].n,
      ).toBe(before);
    });
  },
);
