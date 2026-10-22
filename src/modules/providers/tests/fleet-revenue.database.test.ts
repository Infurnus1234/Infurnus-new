import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixture, actor } from './fleet-workflow-fixture.js';
import { pool } from '../../../infrastructure/database/postgres.js';
import { FleetRevenueRepository } from '../../fleet/repositories/fleet-revenue.repository.js';
const reports = new FleetRevenueRepository(pool);
async function completedRide(f: Awaited<ReturnType<typeof fixture>>, at = 'NOW()') {
  await new PostgresDriverRepository(pool).claimAssignmentCode(f.code, f.driver, f.profile);
  const customer = await actor('customer');
  return (
    await pool.query(
      `INSERT INTO rides(customer_id,assigned_driver_id,assigned_vehicle_id,pickup_location,destination_location,status,completed_at,final_fare)
 VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography,ST_SetSRID(ST_MakePoint(85.2,25.7),4326)::geography,'completed',${at},999) RETURNING id`,
      [customer, f.profile, f.vehicle.id],
    )
  ).rows[0].id as string;
}
async function payment(ride: string, amount: string, at = 'NOW()') {
  const user = (await pool.query('SELECT customer_id FROM rides WHERE id=$1', [ride])).rows[0]
    .customer_id;
  return (
    await pool.query(
      `INSERT INTO payments(user_id,ride_id,status,amount,authorized_at,captured_at) VALUES($1,$2,'CAPTURED',$3,${at},${at}) RETURNING id`,
      [user, ride, amount],
    )
  ).rows[0].id as string;
}
describe.runIf(process.env.PROVIDER_DB_TESTS === 'true')(
  'Payment-backed owner and vehicle revenue',
  () => {
    beforeAll(() => {
      if (!/^\/admin_master_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname))
        throw Error('Owned disposable database required');
    });
    it('uses captured payments and successful refunds exactly once, never unpaid estimated fares', async () => {
      const f = await fixture(),
        ride = await completedRide(f),
        pay = await payment(ride, '100.25');
      await completedRide(f);
      await pool.query(
        "INSERT INTO payment_refunds(payment_id,amount,status,processed_at) VALUES($1,20.10,'SUCCESS',NOW()),($1,7.77,'PENDING',NULL)",
        [pay],
      );
      const report = await reports.report(f.owner);
      expect(report.summary.grossRevenuePaise).toBe('10025');
      expect(report.summary.refundPaise).toBe('2010');
      expect(report.summary.netRevenuePaise).toBe('8015');
      expect(report.summary.completedJobs).toBe(1);
      expect(report.vehicles[0].vehicleId).toBe(f.vehicle.id);
      expect(report.vehicles[0].netRevenuePaise).toBe('8015');
      expect(report.timeZone).toBe('Asia/Kolkata');
    });
    it('fully refunded payments contribute no earned revenue and cannot double-count refund rows', async () => {
      const f = await fixture(),
        ride = await completedRide(f),
        pay = await payment(ride, '50.00');
      await pool.query("UPDATE payments SET status='REFUNDED',refunded_at=NOW() WHERE id=$1", [
        pay,
      ]);
      await pool.query(
        "INSERT INTO payment_refunds(payment_id,amount,status,processed_at) VALUES($1,50,'SUCCESS',NOW())",
        [pay],
      );
      const report = await reports.report(f.owner);
      expect(report.summary.grossRevenuePaise).toBe('5000');
      expect(report.summary.refundPaise).toBe('5000');
      expect(report.summary.netRevenuePaise).toBe('0');
      expect(report.summary.completedJobs).toBe(0);
    });
    it('scopes reports and per-vehicle details to actual ownership, denying Driver access', async () => {
      const a = await fixture(),
        b = await fixture();
      await payment(await completedRide(b), '200.00');
      expect((await reports.report(a.owner)).summary.netRevenuePaise).toBe('0');
      await expect(reports.report(a.owner, { vehicleId: b.vehicle.id })).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(reports.report(a.driver)).rejects.toMatchObject({ statusCode: 403 });
    });
    it('uses the business date at a UTC midnight boundary and accepts date filters', async () => {
      const f = await fixture(),
        at = "'2089-12-31T20:00:00Z'::timestamptz";
      await payment(await completedRide(f, at), '12.34', at);
      expect(
        (await reports.report(f.owner, { from: '2090-01-01', to: '2090-01-01' })).summary
          .netRevenuePaise,
      ).toBe('1234');
      expect(
        (await reports.report(f.owner, { from: '2089-12-31', to: '2089-12-31' })).summary
          .netRevenuePaise,
      ).toBe('0');
    });
    it('excludes failed payments and paid cancelled jobs, and includes completed linked rentals', async () => {
      const f = await fixture(),
        ride = await completedRide(f),
        user = (await pool.query('SELECT customer_id FROM rides WHERE id=$1', [ride])).rows[0]
          .customer_id;
      await pool.query(
        "INSERT INTO payments(user_id,ride_id,status,amount,failed_at) VALUES($1,$2,'FAILED',99,NOW())",
        [user, ride],
      );
      const cancelled = (
        await pool.query(
          `INSERT INTO rides(customer_id,assigned_driver_id,assigned_vehicle_id,pickup_location,destination_location,status,cancelled_at,cancellation_reason)
   VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography,ST_SetSRID(ST_MakePoint(85.2,25.7),4326)::geography,'cancelled',NOW(),'TEST_SAMPLE cancelled') RETURNING id`,
          [user, f.profile, f.vehicle.id],
        )
      ).rows[0].id;
      await payment(cancelled, '90.00');
      const rental = (
        await pool.query(
          "INSERT INTO rentals(user_id,vehicle_id,start_at,end_at,status,total_amount,completed_at) VALUES($1,$2,NOW()-INTERVAL '2 days',NOW()-INTERVAL '1 day','COMPLETED',250.50,NOW()) RETURNING id",
          [user, f.vehicle.id],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO payments(user_id,rental_id,status,amount,authorized_at,captured_at) VALUES($1,$2,'CAPTURED',250.50,NOW(),NOW())",
        [user, rental],
      );
      const report = await reports.report(f.owner);
      expect(report.summary.netRevenuePaise).toBe('25050');
      expect(report.summary.completedJobs).toBe(1);
      expect(report.history.map((x) => x.kind)).toEqual(['rental']);
    });
  },
);
