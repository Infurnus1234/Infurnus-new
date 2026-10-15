import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { requireDisposableAdministrativeDatabase } from './administrative-test-database.js';
import { PostgresAdminRepository } from '../repositories/admin.repository.js';
import {
  AdminOperationsRepository,
  operationQuerySchema,
} from '../repositories/operations.repository.js';
import { AdminController } from '../controllers/admin.controller.js';
import { AdminService } from '../services/admin.service.js';
import { createAdminRouter } from '../routes/admin.routes.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';

describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Dashboard Indian calendar cohorts on real PostgreSQL',
  () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const accounts = new PostgresAdminRepository(pool),
      operations = new AdminOperationsRepository(pool);
    const users: string[] = [],
      vehicles: string[] = [],
      rides: string[] = [],
      payments: string[] = [];
    let admin: string, token: string;
    const app = express();
    app.use('/admin', createAdminRouter(new AdminController(new AdminService(accounts))));
    app.use(errorMiddleware);
    beforeAll(async () => {
      requireDisposableAdministrativeDatabase();
      await pool.query("SET TIME ZONE 'America/Los_Angeles'");
      admin = randomUUID();
      users.push(admin);
      await pool.query(
        "INSERT INTO users(id,first_name,last_name,email,role,created_at) VALUES($1,'TEST_ONLY','Owner',$2,'super_admin','2001-01-01T00:00:00Z')",
        [admin, admin + '@example.invalid'],
      );
      token = await signAccessToken({ sub: admin, role: 'super_admin', type: 'access' });
      const moments = [
        '2090-01-14T18:29:59Z',
        '2090-01-14T18:30:00Z',
        '2090-01-15T18:29:59.999Z',
        '2090-01-15T18:30:00Z',
      ];
      for (const moment of moments) {
        const id = randomUUID();
        users.push(id);
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role,created_at) VALUES($1,'TEST_ONLY','Boundary',$2,'driver',$3)",
          [id, id + '@example.invalid', moment],
        );
        await pool.query(
          "INSERT INTO driver_profiles(user_id,license_number,license_expiry,created_at) VALUES($1,$2,'2099-01-01',$3)",
          [id, 'TEST_ONLY_' + id, moment],
        );
        const vehicle = (
          await pool.query(
            "INSERT INTO vehicles(make,model,plate_number,created_at) VALUES('TEST_ONLY','Boundary',$1,$2) RETURNING id",
            ['TEST' + randomUUID().slice(0, 12), moment],
          )
        ).rows[0].id;
        vehicles.push(vehicle);
        const ride = (
          await pool.query(
            "INSERT INTO rides(customer_id,status,pickup_location,destination_location,created_at,updated_at) VALUES($1,'requested',ST_SetSRID(ST_Point(85.1,25.6),4326)::geography,ST_SetSRID(ST_Point(85.2,25.6),4326)::geography,$2,$2) RETURNING id",
            [id, moment],
          )
        ).rows[0].id;
        rides.push(ride);
      }
      const payment = (
        await pool.query(
          "INSERT INTO payments(user_id,ride_id,status,amount,currency,created_at,authorized_at,captured_at,updated_at) VALUES($1,$2,'CAPTURED',12.50,'XTS','2089-12-01T00:00:00Z','2090-01-14T18:30:00Z','2090-01-14T18:30:00Z','2090-01-14T18:30:00Z') RETURNING id",
          [users[1], rides[0]],
        )
      ).rows[0].id;
      payments.push(payment);
    });
    afterAll(async () => {
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
        [users],
      );
      await pool.query('DELETE FROM payments WHERE id=ANY($1::uuid[])', [payments]);
      await pool.query('DELETE FROM rides WHERE id=ANY($1::uuid[])', [rides]);
      await pool.query('DELETE FROM vehicles WHERE id=ANY($1::uuid[])', [vehicles]);
      await pool.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
      await pool.end();
    });
    it('includes midnight and the final millisecond, excluding both adjacent days independently of database timezone', async () => {
      const result = await request(app)
        .get('/admin/dashboard?from=2090-01-15&to=2090-01-15')
        .auth(token, { type: 'bearer' });
      expect(result.status).toBe(200);
      expect(result.body.data.users.total).toBe(2);
      expect(result.body.data.drivers.total).toBe(2);
      expect(result.body.data.vehicles.total).toBe(2);
    });
    it('account and inventory drilldowns reconcile with the Dashboard', async () => {
      for (const path of ['users', 'drivers', 'vehicles']) {
        const result = await request(app)
          .get(`/admin/${path}?from=2090-01-15&to=2090-01-15`)
          .auth(token, { type: 'bearer' });
        expect(result.status).toBe(200);
        expect(result.body.data.total).toBe(2);
      }
    });
    it('booking summaries, categories and record lists use the same calendar cohort', async () => {
      const summary = await operations.summary('2090-01-15', '2090-01-15', true);
      expect(summary.rides).toEqual([{ status: 'requested', count: 2 }]);
      expect(summary.vehicleCategories[0]?.total).toBe(2);
      expect(
        (
          await operations.list(
            'rides',
            operationQuerySchema.parse({ from: '2090-01-15', to: '2090-01-15' }),
          )
        ).total,
      ).toBe(2);
    });
    it('captured receipts use captured_at rather than payment creation time', async () => {
      const summary = await operations.summary('2090-01-15', '2090-01-15', true);
      expect(summary.receiptSeries).toEqual([
        { month: '2090-01', currency: 'XTS', amount: '12.50' },
      ]);
      expect(
        (await operations.summary('2090-01-15', '2090-01-15', false)).receiptSeries,
      ).toBeNull();
    });
    it('empty ranges return zeros and all time retains the historical registrations', async () => {
      expect((await accounts.dashboard({ from: '2088-01-01', to: '2088-01-01' })).users.total).toBe(
        0,
      );
      expect((await accounts.dashboard()).users.total).toBeGreaterThanOrEqual(5);
    });
    it('rejects invalid dates, reversed ranges, unknown parameters and unauthorized callers', async () => {
      for (const query of ['from=2090-02-30', 'from=2090-02-01&to=2090-01-01', 'timezone=UTC'])
        expect(
          (
            await request(app)
              .get('/admin/dashboard?' + query)
              .auth(token, { type: 'bearer' })
          ).status,
        ).toBe(400);
      expect((await request(app).get('/admin/dashboard')).status).toBe(401);
      const driver = await signAccessToken({ sub: users[1]!, role: 'driver', type: 'access' });
      expect(
        (await request(app).get('/admin/dashboard').auth(driver, { type: 'bearer' })).status,
      ).toBe(403);
    });
  },
);
