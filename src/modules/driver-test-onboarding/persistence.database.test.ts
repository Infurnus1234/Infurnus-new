import { createApp } from '../../app.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { pool } from '../../infrastructure/database/postgres.js';
import { PostgresDriverRepository } from '../rides/repositories/driver.repository.js';
import { PostgresRideRepository } from '../rides/repositories/ride.repository.js';
import { PostgresUserRepository } from '../users/repositories/user.repository.js';
import { PostgresProviderOperationsRepository } from '../providers/repositories/provider-operations.repository.js';

describe.skipIf(process.env.DRIVER_IMPLEMENTATION_DB_TESTS !== 'true')(
  'temporary onboarding real database persistence',
  () => {
    const prior = env.DRIVER_TEST_ONBOARDING_ENABLED;
    const ids: string[] = [];
    const app = createApp(
      new PostgresUserRepository(pool),
      undefined,
      undefined,
      undefined,
      undefined,
      new PostgresRideRepository(pool),
      new PostgresDriverRepository(pool),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new PostgresProviderOperationsRepository(pool),
    );
    beforeAll(() => {
      env.DRIVER_TEST_ONBOARDING_ENABLED = 'true';
    });
    afterAll(async () => {
      env.DRIVER_TEST_ONBOARDING_ENABLED = prior;
      try {
        if (ids.length) {
          await pool.query(
            'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
            [ids],
          );
          await pool.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [ids]);
          await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
        }
      } finally {
        await pool.end();
      }
    });
    async function start() {
      const response = await request(app).post('/driver-test-onboarding/sessions').send({});
      expect(response.status).toBe(201);
      ids.push(response.body.data.userId);
      return response.body.data as { userId: string; sessionToken: string };
    }
    it('persists a real unverified Driver and its licence under the server identity', async () => {
      const a = await start();
      expect(
        (
          await request(app)
            .patch('/driver-test-onboarding/users/' + a.userId)
            .auth(a.sessionToken, { type: 'bearer' })
            .send({ firstName: 'Local', lastName: 'Test' })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .post('/driver-test-onboarding/rides/driver/profile')
            .auth(a.sessionToken, { type: 'bearer' })
            .send({
              licenseNumber: 'LOCAL-TEST-NOT-VALID-' + a.userId.slice(0, 8),
              licenseExpiry: '2099-12-31',
            })
        ).status,
      ).toBe(200);
      const result = await pool.query(
        'select u.role,u.email_verified,u.phone_verified,p.license_number from users u join driver_profiles p on p.user_id=u.id where u.id=$1',
        [a.userId],
      );
      expect(result.rows[0]).toMatchObject({
        role: 'driver',
        email_verified: false,
        phone_verified: false,
      });
      expect(result.rows[0].license_number).toContain('LOCAL-TEST-NOT-VALID-');
    });
    it('cannot read or modify another real temporary account', async () => {
      const a = await start(),
        b = await start();
      for (const method of ['get', 'patch'] as const) {
        const client = request(app);
        const response = await client[method]('/driver-test-onboarding/users/' + a.userId)
          .auth(b.sessionToken, { type: 'bearer' })
          .send(method === 'patch' ? { firstName: 'Unauthorized' } : undefined);
        expect(response.status).toBe(403);
      }
      expect(
        (await pool.query('select first_name from users where id=$1', [a.userId])).rows[0]
          .first_name,
      ).toBe('');
    });
    it('invalid profile never creates a database record', async () => {
      const a = await start();
      expect(
        (
          await request(app)
            .post('/driver-test-onboarding/rides/driver/profile')
            .auth(a.sessionToken, { type: 'bearer' })
            .send({ licenseNumber: '', licenseExpiry: '2000-01-01' })
        ).status,
      ).toBe(400);
      expect(
        (
          await pool.query('select count(*)::int as n from driver_profiles where user_id=$1', [
            a.userId,
          ])
        ).rows[0].n,
      ).toBe(0);
    });
  },
);
