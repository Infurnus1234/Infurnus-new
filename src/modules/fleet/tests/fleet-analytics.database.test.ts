import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { fixture, actor } from '../../providers/tests/fleet-workflow-fixture.js';
import { PostgresFleetRepository } from '../repositories/fleet.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { createFleetVehicleSchema } from '../schemas/fleet.schemas.js';
import { FleetController } from '../controllers/fleet.controller.js';
import { FleetService } from '../services/fleet.service.js';
import { createFleetRouter } from '../routes/fleet.routes.js';
import { RefreshTokenService } from '../../auth/services/refresh-token.service.js';
import { PostgresRefreshTokenRepository } from '../../auth/repositories/refresh-token.repository.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { env } from '../../../config/env.js';
import { fleetActivitySql } from '../repositories/fleet-analytics.repository.js';
const repo = new PostgresFleetRepository(pool),
  drivers = new PostgresDriverRepository(pool);
const app = express();
app.use(express.json());
app.use('/fleet', createFleetRouter(new FleetController(new FleetService(repo))));
app.use(errorMiddleware);
async function bearer(id: string, role = 'fleet_owner') {
  const session = await new RefreshTokenService(new PostgresRefreshTokenRepository()).create(id);
  return signAccessToken({ sub: id, role, type: 'access', sid: session.familyId });
}
async function ride(
  f: Awaited<ReturnType<typeof fixture>>,
  vehicle: string,
  amount: number,
  at = '2026-10-23T07:00:00Z',
  status = 'completed',
  distance: number = 1000,
) {
  const customer = await actor('customer');
  return (
    await pool.query(
      `INSERT INTO rides(customer_id,assigned_driver_id,assigned_vehicle_id,pickup_location,destination_location,status,completed_at,cancelled_at,cancellation_reason,created_at,final_fare,commission_amount,actual_distance_meters)
 VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint(85,25),4326)::geography,ST_SetSRID(ST_MakePoint(86,26),4326)::geography,$4::ride_status,
 CASE WHEN $4::text='completed' THEN $5::timestamptz END,CASE WHEN $4::text='cancelled' THEN $5::timestamptz END,CASE WHEN $4::text='cancelled' THEN 'TEST_SAMPLE cancelled' END,
 $5::timestamptz-INTERVAL '1 hour',$6,$6*0.1,$7) RETURNING id,customer_id`,
      [customer, f.profile, vehicle, status, at, amount, distance],
    )
  ).rows[0]!;
}
async function payment(
  r: { id: string; customer_id: string },
  amount: number,
  status = 'CAPTURED',
) {
  return (
    await pool.query(
      `INSERT INTO payments(user_id,ride_id,amount,status,authorized_at,captured_at,failed_at,refunded_at,idempotency_key)
 VALUES($1,$2,$3,$4::payment_status,CASE WHEN $4::text IN ('CAPTURED','AUTHORIZED','REFUNDED') THEN NOW() END,CASE WHEN $4::text IN ('CAPTURED','REFUNDED') THEN NOW() END,CASE WHEN $4::text='FAILED' THEN NOW() END,CASE WHEN $4::text='REFUNDED' THEN NOW() END,$5) RETURNING id`,
      [r.customer_id, r.id, amount, status, randomUUID()],
    )
  ).rows[0]!.id;
}
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Fleet analytics actual routes and historical database records',
  () => {
    let f: Awaited<ReturnType<typeof fixture>>, token: string, ids: string[], rideIds: string[];
    beforeAll(async () => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Disposable DB required');
      f = await fixture();
      token = await bearer(f.owner);
      ids = [];
      rideIds = [];
      for (let i = 1; i <= 4; i++) {
        const v =
          i === 1
            ? f.vehicle
            : await repo.createVehicle(
                f.owner,
                createFleetVehicleSchema.parse({
                  make: 'TEST_SAMPLE',
                  model: 'Analytics',
                  plateNumber: randomUUID().slice(0, 20),
                  sector: 'passenger',
                  category: 'sedan',
                }),
              );
        if (i > 1)
          await pool.query(
            "UPDATE vehicles SET verification_status='approved',verified_by=$2,verified_at=NOW(),is_active=TRUE WHERE id=$1",
            [v.id, f.admin],
          );
        await drivers.claimAssignmentCode(v.activeAssignmentCode!, f.driver, f.profile);
        ids.push(v.id);
        const r = await ride(f, v.id, i * 100, undefined, 'completed', i === 4 ? 0 : i * 1000);
        rideIds.push(r.id);
        const pay = await payment(r, i * 80, i === 4 ? 'INITIATED' : 'CAPTURED');
        if (i === 1) {
          await payment(r, 5, 'REFUNDED');
          await payment(r, 15.5, 'FAILED');
          await pool.query(
            "INSERT INTO payment_refunds(payment_id,amount,status,processed_at) VALUES($1,10,'SUCCESS',NOW()),($1,7,'PENDING',NULL)",
            [pay],
          );
          await ride(f, v.id, 999, undefined, 'cancelled');
        }
        await repo.unassignDriver(f.owner, v.id);
      }
    });
    async function report(path = '/fleet/revenue') {
      const r = await request(app)
        .get(path)
        .set('Authorization', 'Bearer ' + token);
      expect(r.status).toBe(200);
      return r.body.data.analytics;
    }
    it('four vehicles reconcile completed trips, gross fares, receipts, commissions, refunds and measured coverage', async () => {
      const a = await report();
      expect(a.inventory.total).toBe(4);
      expect(a.summary.completedTrips).toBe(4);
      expect(a.summary.cancelledTrips).toBe(1);
      expect(a.summary.grossFarePaise).toBe('100000');
      expect(a.summary.capturedPaise).toBe('48500');
      expect(a.summary.refundPaise).toBe('1500');
      expect(a.summary.collectedAfterRefundsPaise).toBe('47000');
      expect(a.summary.pendingAttemptPaise).toBe('32000');
      expect(a.summary.failedAttemptPaise).toBe('1550');
      expect(a.summary.recordedRideCommissionPaise).toBe('10000');
      expect(a.summary.knownDistanceMeters).toBe('6000');
      expect(a.summary.distanceCoveredTrips).toBe(3);
      expect(a.summary.knownOperatingSeconds).toBeNull();
      expect(a.summary.timeCoveredTrips).toBe(0);
      expect(a.summary.averageCollectedPerCompletedTripPaise).toBe('11750');
      expect(a.summary.ownerNetEarningsPaise).toBeNull();
      expect(a.summary.settledPaise).toBeNull();
      expect(
        a.vehicles.reduce((n: number, v: { completedTrips: number }) => n + v.completedTrips, 0),
      ).toBe(4);
      expect(
        a.vehicles.reduce(
          (n: bigint, v: { grossFarePaise: string }) => n + BigInt(v.grossFarePaise),
          0n,
        ) === 100000n,
      ).toBe(true);
    });
    it('each vehicle excludes all other histories and preserves attribution after driver reassignment', async () => {
      for (let i = 0; i < ids.length; i++) {
        const a = await report('/fleet/vehicles/' + ids[i] + '/revenue');
        expect(a.summary.completedTrips).toBe(1);
        expect(a.summary.grossFarePaise).toBe(String((i + 1) * 10000));
        expect(a.vehicles).toHaveLength(1);
        expect(a.history.every((r: { vehicleId: string }) => r.vehicleId === ids[i])).toBe(true);
        expect(a.history.some((r: { id: string }) => r.id === rideIds[i])).toBe(true);
        expect(a.vehicles[0].assignedDriverId).toBeNull();
      }
    });
    it('date presets use database local calendar boundaries and custom bounds are end-exclusive', async () => {
      for (const period of ['today', 'this_week', 'this_month', 'all_time']) {
        const a = await report('/fleet/revenue?period=' + period);
        expect(a.period.name).toBe(period);
        expect(a.timeZone).toBe('Asia/Kolkata');
      }
      const a = await report('/fleet/revenue?period=custom&from=2026-10-23&to=2026-10-23');
      expect(a.summary.completedTrips).toBe(4);
      expect(a.period.start).toBe('2026-10-22T18:30:00.000Z');
      expect(a.period.endExclusive).toBe('2026-10-23T18:30:00.000Z');
      expect(
        (await report('/fleet/revenue?from=2026-10-24&to=2026-10-24')).summary.completedTrips,
      ).toBe(0);
    });
    it('supports daily weekly monthly trends and stable independent page boundaries', async () => {
      for (const interval of ['day', 'week', 'month']) {
        const a = await report('/fleet/revenue?interval=' + interval);
        expect(
          a.trends.reduce((n: number, r: { completedTrips: number }) => n + r.completedTrips, 0),
        ).toBe(4);
      }
      const a = await report('/fleet/revenue?limit=2'),
        b = await report('/fleet/revenue?limit=2&historyOffset=2&vehicleOffset=2');
      expect(a.history).toHaveLength(2);
      expect(b.history).toHaveLength(2);
      expect(a.pagination.history.total).toBe(5);
      expect(a.pagination.vehicles.total).toBe(4);
      const beyond = await report('/fleet/revenue?trendOffset=100');
      expect(beyond.trends).toEqual([]);
      expect(beyond.pagination.trends.total).toBe(1);
      expect(new Set([...a.vehicles, ...b.vehicles].map((v) => v.vehicleId)).size).toBe(4);
      expect(new Set([...a.history, ...b.history].map((v) => v.id)).size).toBe(4);
    });
    it('denies missing credentials, wrong roles, another owner vehicle, owner substitution and invalid queries', async () => {
      expect((await request(app).get('/fleet/revenue')).status).toBe(401);
      const driver = await bearer(f.driver, 'driver');
      expect(
        (
          await request(app)
            .get('/fleet/revenue')
            .set('Authorization', 'Bearer ' + driver)
        ).status,
      ).toBe(403);
      const other = await fixture();
      expect(
        (
          await request(app)
            .get('/fleet/vehicles/' + other.vehicle.id + '/revenue')
            .set('Authorization', 'Bearer ' + token)
        ).status,
      ).toBe(404);
      for (const q of [
        'ownerId=' + other.owner,
        'period=custom',
        'period=today&from=2026-01-01',
        'from=2026-02-30',
        'from=2026-01-02&to=2026-01-01',
        'from=2000-01-01&to=2026-01-01',
        'limit=101',
        'historyOffset=-1',
        'interval=invalid',
      ])
        expect(
          (
            await request(app)
              .get('/fleet/revenue?' + q)
              .set('Authorization', 'Bearer ' + token)
          ).status,
        ).toBe(400);
    });
    it('empty fleets and unmeasured vehicles return explicit zero counts and unavailable measurements', async () => {
      const empty = await actor('fleet_owner');
      const r = await request(app)
        .get('/fleet/revenue')
        .set('Authorization', 'Bearer ' + (await bearer(empty)));
      expect(r.status).toBe(200);
      expect(r.body.data.analytics.inventory.total).toBe(0);
      expect(r.body.data.analytics.summary.knownDistanceMeters).toBeNull();
      expect(r.body.data.analytics.history).toEqual([]);
    });
    it('midnight and month transitions attribute trips to completion, not request date', async () => {
      const g = await fixture();
      await drivers.claimAssignmentCode(g.code, g.driver, g.profile);
      await ride(g, g.vehicle.id, 10, '2026-09-30T18:29:59Z');
      await ride(g, g.vehicle.id, 20, '2026-09-30T18:30:00Z');
      const t = await bearer(g.owner);
      const sep = await request(app)
        .get('/fleet/revenue?from=2026-09-30&to=2026-09-30')
        .set('Authorization', 'Bearer ' + t);
      const oct = await request(app)
        .get('/fleet/revenue?from=2026-10-01&to=2026-10-01')
        .set('Authorization', 'Bearer ' + t);
      expect(sep.status).toBe(200);
      expect(oct.status).toBe(200);
      expect(sep.body.data.analytics.summary.grossFarePaise).toBe('1000');
      expect(oct.body.data.analytics.summary.grossFarePaise).toBe('2000');
      expect(oct.body.data.analytics.summary.completedTrips).toBe(1);
    });
    it('calendar bounds respect a 23-hour daylight-saving day when reporting timezone is configured', async () => {
      const prior = env.FLEET_REPORT_TIME_ZONE;
      try {
        env.FLEET_REPORT_TIME_ZONE = 'America/New_York';
        const a = await report('/fleet/revenue?from=2026-03-08&to=2026-03-08');
        expect(a.period.start).toBe('2026-03-08T05:00:00.000Z');
        expect(a.period.endExclusive).toBe('2026-03-09T04:00:00.000Z');
      } finally {
        env.FLEET_REPORT_TIME_ZONE = prior;
      }
    });
    it('missing fares, paid cancellations and rejected or timed-out offers do not manufacture completed earnings', async () => {
      const g = await fixture();
      await drivers.claimAssignmentCode(g.code, g.driver, g.profile);
      const done = await ride(g, g.vehicle.id, 100),
        cancelled = await ride(g, g.vehicle.id, 200, undefined, 'cancelled'),
        search = await ride(g, g.vehicle.id, 300, undefined, 'searching');
      await pool.query(
        'UPDATE rides SET final_fare=NULL,commission_amount=NULL,actual_distance_meters=0 WHERE id=$1',
        [done.id],
      );
      await payment(done, 100);
      await payment(cancelled, 200);
      const other = await fixture();
      await pool.query(
        "INSERT INTO ride_dispatch_attempts(ride_id,attempt,driver_profile_id,status,expires_at) VALUES($1,1,$2,'rejected',NOW()),($1,2,$3,'timed_out',NOW())",
        [search.id, g.profile, other.profile],
      );
      const r = await request(app)
        .get('/fleet/revenue')
        .set('Authorization', 'Bearer ' + (await bearer(g.owner)));
      expect(r.status).toBe(200);
      const a = r.body.data.analytics;
      expect(a.summary.completedTrips).toBe(1);
      expect(a.summary.totalJobs).toBe(3);
      expect(a.summary.missingFareTrips).toBe(1);
      expect(a.summary.grossFarePaise).toBe('0');
      expect(a.summary.capturedPaise).toBe('10000');
      expect(a.summary.knownDistanceMeters).toBeNull();
      expect(a.summary.averageGrossFarePaise).toBeNull();
    });
    it('completed linked rentals contribute fares and refunds without inventing distance or operating time', async () => {
      const g = await fixture(),
        customer = await actor('customer');
      const rental = (
        await pool.query(
          "INSERT INTO rentals(user_id,vehicle_id,start_at,end_at,status,total_amount,completed_at) VALUES($1,$2,NOW()-INTERVAL '2 days',NOW()-INTERVAL '1 day','COMPLETED',25.50,NOW()) RETURNING id",
          [customer, g.vehicle.id],
        )
      ).rows[0].id;
      const pay = (
        await pool.query(
          "INSERT INTO payments(user_id,rental_id,status,amount,authorized_at,captured_at) VALUES($1,$2,'CAPTURED',25.50,NOW(),NOW()) RETURNING id",
          [customer, rental],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO payment_refunds(payment_id,amount,status,processed_at) VALUES($1,5.05,'SUCCESS',NOW())",
        [pay],
      );
      const r = await request(app)
        .get('/fleet/revenue')
        .set('Authorization', 'Bearer ' + (await bearer(g.owner)));
      expect(r.status).toBe(200);
      const a = r.body.data.analytics;
      expect(a.summary.completedTrips).toBe(1);
      expect(a.summary.grossFarePaise).toBe('2550');
      expect(a.summary.collectedAfterRefundsPaise).toBe('2045');
      expect(a.summary.knownDistanceMeters).toBeNull();
      expect(a.summary.knownOperatingSeconds).toBeNull();
      expect(a.history[0].kind).toBe('rental');
    });
    it('query plans use database aggregation with bounded output, not per-vehicle application queries', async () => {
      const plan = (
        await pool.query(
          'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' +
            fleetActivitySql +
            'SELECT COUNT(*) FROM activity',
          [f.owner, null, null, null, 'Asia/Kolkata'],
        )
      ).rows[0];
      // Keep the same bound owner, range and reporting timezone as production.
      expect(plan['QUERY PLAN'][0].Plan['Node Type']).toBe('Aggregate');
      expect(plan['QUERY PLAN'][0].Plan['Actual Rows']).toBe(1);
      await mkdir('tmp', { recursive: true });
      await writeFile(
        'tmp/fleet-analytics-query-plan.json',
        JSON.stringify(plan['QUERY PLAN'], null, 2),
      );
    });
  },
);
