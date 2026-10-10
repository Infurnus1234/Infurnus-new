import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { createProviderApprovalRouter } from '../routes/provider-operations.routes.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Database details timestamp review round trip',
  () => {
    let users: string[] = [];
    let approvalId: string;
    let profileId: string;
    let admin: string;
    let driver: string;
    const repository = new PostgresProviderOperationsRepository(pool);
    const app = express();
    app.use(express.json());
    app.use('/provider-approvals', requireAuth, createProviderApprovalRouter(repository));
    app.use(errorMiddleware);
    beforeEach(async () => {
      if (new URL(process.env.DATABASE_URL!).port !== '5434')
        throw new Error('Isolated audit database required');
      users = [];
      for (const role of ['admin', 'driver']) {
        const id = randomUUID();
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_SAMPLE_NOT_ID','Timestamp',$2,$3)",
          [id, `${id}@example.invalid`, role],
        );
        users.push(id);
      }
      profileId = (
        await pool.query(
          'INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,CURRENT_DATE+365) RETURNING id',
          [users[1], randomUUID()],
        )
      ).rows[0].id;
      // Explicit microseconds ensure the round trip cannot quietly truncate precision.
      await pool.query(
        "UPDATE driver_profiles SET updated_at='2026-10-11T01:02:03.123456+00:00' WHERE id=$1",
        [profileId],
      );
      approvalId = (
        await pool.query(
          "SELECT id FROM provider_approval_requests WHERE target_type='driver_profile' AND target_id=$1 AND status='PENDING'",
          [profileId],
        )
      ).rows[0].id;
      admin = `Bearer ${await signAccessToken({ sub: users[0]!, role: 'admin', type: 'access' })}`;
      driver = `Bearer ${await signAccessToken({ sub: users[1]!, role: 'driver', type: 'access' })}`;
    });
    afterEach(async () => {
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
        [users],
      );
      await pool.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
    });
    for (const status of ['APPROVED', 'REJECTED'])
      it(`reviews ${status} using the unmodified details timestamp`, async () => {
        const detail = await request(app)
          .get(`/provider-approvals/${approvalId}`)
          .set('Authorization', admin)
          .expect(200);
        expect(detail.body.data.target.updated_at).toMatch(/\+00:00$/);
        const body = {
          status,
          expectedUpdatedAt: detail.body.data.target.updated_at,
          ...(status === 'REJECTED' ? { reason: 'Synthetic test rejection' } : {}),
        };
        await request(app)
          .post(`/provider-approvals/${approvalId}/review`)
          .set('Authorization', admin)
          .send(body)
          .expect(200);
        expect(
          (
            await pool.query('SELECT status FROM provider_approval_requests WHERE id=$1', [
              approvalId,
            ])
          ).rows[0].status,
        ).toBe(status);
        expect(
          (
            await pool.query('SELECT verification_status FROM driver_profiles WHERE id=$1', [
              profileId,
            ])
          ).rows[0].verification_status,
        ).toBe(status.toLowerCase());
      });
    it('retains stale, invalid timestamp and authorization rejection', async () => {
      const endpoint = `/provider-approvals/${approvalId}/review`;
      const body = { status: 'APPROVED', expectedUpdatedAt: '2000-01-01T00:00:00.123456+00:00' };
      await request(app).post(endpoint).set('Authorization', admin).send(body).expect(409);
      await request(app)
        .post(endpoint)
        .set('Authorization', admin)
        .send({ ...body, expectedUpdatedAt: 'not-a-date' })
        .expect(400);
      await request(app).post(endpoint).send(body).expect(401);
      await request(app).post(endpoint).set('Authorization', driver).send(body).expect(403);
    });
  },
);
