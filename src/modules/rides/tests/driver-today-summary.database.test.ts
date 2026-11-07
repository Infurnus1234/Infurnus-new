import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import express from 'express';
import { pool } from '../../../infrastructure/database/postgres.js';
import { DriverTodaySummaryRepository } from '../repositories/driver-today-summary.repository.js';
import { fixture, actor } from '../../providers/tests/fleet-workflow-fixture.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { DriverController } from '../controllers/driver.controller.js';
import { RideController } from '../controllers/ride.controller.js';
import { createRideRouter } from '../routes/ride.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';

describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'driver summary calendar-day boundaries and scope',
  () => {
    let f: Awaited<ReturnType<typeof fixture>>, customer: string;
    const now = new Date('2026-01-15T09:00:00Z');
    beforeAll(async () => {
      requireDisposableAdministrativeDatabase();
      f = await fixture();
      await new PostgresDriverRepository(pool).claimAssignmentCode(f.code, f.driver, f.profile);
      customer = await actor('customer');
    });
    afterAll(async () => {
      if (!f) return;
      await pool.query('DELETE FROM rides WHERE customer_id=$1', [customer]);
      await pool.query('DELETE FROM vehicles WHERE owner_id=$1', [f.owner]);
      await pool.query('DELETE FROM partner_drivers WHERE driver_profile_id=$1', [f.profile]);
      await pool.query('DELETE FROM driver_profiles WHERE id=$1', [f.profile]);
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
        [[customer, f.owner, f.driver, f.admin]],
      );
      await pool.query('DELETE FROM partners WHERE id=$1', [f.partner]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
        [customer, f.owner, f.driver, f.admin],
      ]);
    });
    it('counts local-midnight events, carry-over decisions and today completions, not historical totals', async () => {
      const repo = new DriverTodaySummaryRepository(pool, 'Asia/Kolkata');
      const empty = await repo.get(f.profile, now);
      expect(empty.date).toBe('2026-01-15');
      expect(empty.startsAt.toISOString()).toBe('2026-01-14T18:30:00.000Z');
      const start = +empty.startsAt,
        end = +empty.endsAt;
      async function ride(completed?: number) {
        const id = randomUUID();
        await pool.query(
          `INSERT INTO rides(id,customer_id,vehicle_category,status,pickup_location,destination_location,created_at,assigned_driver_id,assigned_vehicle_id,completed_at)
    VALUES($1,$2,'sedan',$3,ST_SetSRID(ST_MakePoint(85,25),4326)::geography,ST_SetSRID(ST_MakePoint(85.1,25.1),4326)::geography,$4,$5,$6,$7)`,
          [
            id,
            customer,
            completed === undefined ? 'searching' : 'completed',
            new Date(start - 172800000),
            completed === undefined ? null : f.profile,
            completed === undefined ? null : f.vehicle.id,
            completed === undefined ? null : new Date(completed),
          ],
        );
        return id;
      }
      for (const [offered, status, responded] of [
        [start, 'accepted', start + 10],
        [start - 1, 'accepted', start + 1],
        [start + 10, 'rejected', start + 20],
        [start + 15, 'timed_out', start + 25],
        [end, 'accepted', end + 1],
      ] as const) {
        const id = await ride();
        await pool.query(
          'INSERT INTO ride_dispatch_attempts(ride_id,attempt,driver_profile_id,status,offered_at,expires_at,responded_at) VALUES($1,1,$2,$3,$4,$5,$6)',
          [
            id,
            f.profile,
            status,
            new Date(offered),
            new Date(offered + 3600000),
            new Date(responded),
          ],
        );
      }
      await ride(start + 60);
      await ride(start - 1);
      await ride(end);
      expect(await repo.get(f.profile, now)).toMatchObject({
        totalRequests: 3,
        accepted: 2,
        rejected: 1,
        totalRides: 1,
      });
    });
    it('projects the saved quote duration and backend catalog name without exposing billing', async () => {
      const type = (
        await pool.query(
          "SELECT id,name FROM vehicle_types WHERE sector='passenger' AND code='sedan' LIMIT 1",
        )
      ).rows[0];
      const id = (await pool.query('SELECT id FROM rides WHERE customer_id=$1 LIMIT 1', [customer]))
        .rows[0].id;
      await pool.query(
        "UPDATE rides SET route_metadata=jsonb_build_object('bookingFareSnapshot',jsonb_build_object('durationSeconds',777,'vehicleConfiguration',jsonb_build_object('id',$2::text))) WHERE id=$1",
        [id, type.id],
      );
      expect(await new PostgresRideRepository(pool).findById(id)).toMatchObject({
        bookingDurationSeconds: 777,
        vehicleName: type.name,
      });
    });
    it.each([
      ['2026-03-08T15:00:00Z', 23],
      ['2026-11-01T15:00:00Z', 25],
    ])('respects daylight-saving calendar boundaries at %s', async (date, hours) => {
      const result = await new DriverTodaySummaryRepository(pool, 'America/New_York').get(
        f.profile,
        new Date(date as string),
      );
      expect((+result.endsAt - +result.startsAt) / 3600000).toBe(hours);
    });
    it('authenticates Driver scope and never accepts another driver ID from the query', async () => {
      const todaySummary = vi.fn(async () => ({
        totalRequests: 0,
        accepted: 0,
        rejected: 0,
        totalRides: 0,
      }));
      const app = express();
      app.use(
        '/rides',
        createRideRouter(
          new RideController({} as never),
          new DriverController({ todaySummary } as never, {} as never, {} as never),
        ),
      );
      app.use(errorMiddleware);
      expect((await request(app).get('/rides/driver/today-summary')).status).toBe(401);
      const customerToken = await signAccessToken({
        sub: customer,
        role: 'customer',
        type: 'access',
      });
      expect(
        (
          await request(app)
            .get('/rides/driver/today-summary')
            .auth(customerToken, { type: 'bearer' })
        ).status,
      ).toBe(403);
      const token = await signAccessToken({ sub: f.driver, role: 'driver', type: 'access' });
      expect(
        (
          await request(app)
            .get('/rides/driver/today-summary?driverId=' + customer)
            .auth(token, { type: 'bearer' })
        ).status,
      ).toBe(200);
      expect(todaySummary).toHaveBeenCalledExactlyOnceWith(f.driver);
    });
  },
);
