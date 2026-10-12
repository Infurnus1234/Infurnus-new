import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminOperationsRepository,
  operationSources,
  operationQuerySchema,
  type OperationModule,
} from '../repositories/operations.repository.js';
import { PostgresAdminRepository } from '../repositories/admin.repository.js';
import { AdminService } from '../services/admin.service.js';
import { AdminController } from '../controllers/admin.controller.js';
import { createAdminRouter } from '../routes/admin.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { adminCouponSchema } from '../../coupons/schemas/admin-coupon.schema.js';
import { PostgresCouponRepository } from '../../coupons/repositories/coupon.repository.js';
const enabled = process.env.PROVIDER_DB_TESTS === 'true';
describe.runIf(enabled)('operational management on migrated PostgreSQL', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const admin = randomUUID(),
    customer = randomUUID(),
    dual = randomUUID();
  const coupons: string[] = [];
  const rides: string[] = [];
  const payments: string[] = [];
  const extraUsers: string[] = [],
    extraVehicles: string[] = [];
  let verifiedLocal = false;
  const repository = new AdminOperationsRepository(pool);
  const accounts = new PostgresAdminRepository(pool);
  const promotion = new PostgresCouponRepository(pool);
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(url.hostname))
      throw Error('Local test database required');
    verifiedLocal = true;
    for (const [id, role] of [
      [admin, 'super_admin'],
      [customer, 'customer'],
      [dual, 'driver_fleet_owner'],
    ])
      await pool.query(
        "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_ONLY','Operations',$2,$3)",
        [id, id + '@example.invalid', role],
      );
    await pool.query(
      'INSERT INTO driver_profiles(user_id,license_number,license_expiry) VALUES($1,$2,CURRENT_DATE+365)',
      [dual, randomUUID()],
    );
  });
  afterAll(async () => {
    if (!verifiedLocal) {
      await pool.end();
      return;
    }
    await pool.query('DELETE FROM payments WHERE id=ANY($1::uuid[])', [payments]);
    await pool.query('DELETE FROM rides WHERE id=ANY($1::uuid[])', [rides]);
    await pool.query('DELETE FROM coupons WHERE id=ANY($1::uuid[])', [coupons]);
    await pool.query('DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])', [
      [dual, ...extraUsers],
    ]);
    await pool.query('DELETE FROM vehicles WHERE id=ANY($1::uuid[])', [extraVehicles]);
    await pool.query('DELETE FROM partners WHERE user_id=ANY($1::uuid[])', [[dual, ...extraUsers]]);
    await pool.query('DELETE FROM driver_profiles WHERE user_id=$1', [dual]);
    await pool.query('DELETE FROM user_history WHERE user_id=ANY($1::uuid[])', [
      [admin, customer, dual, ...extraUsers],
    ]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
      [admin, customer, dual, ...extraUsers],
    ]);
    await pool.end();
  });
  it('uses actual vehicle ownership and does not duplicate fleet counts or fabricate city data', async () => {
    const owner = randomUUID();
    extraUsers.push(owner);
    await pool.query(
      "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'TEST_ONLY','Fleet',$2,'fleet_owner')",
      [owner, owner + '@example.invalid'],
    );
    const partner = (
      await pool.query(
        "INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_ONLY Vehicle Owner') RETURNING id",
        [owner],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO partners(user_id,business_name) VALUES($1,'TEST_ONLY Driver Business')",
      [dual],
    );
    const profile = (await pool.query('SELECT id FROM driver_profiles WHERE user_id=$1', [dual]))
      .rows[0].id;
    const plate = 'TEST' + randomUUID().replaceAll('-', '').slice(0, 12);
    const vehicle = (
      await pool.query(
        "INSERT INTO vehicles(owner_id,driver_profile_id,make,model,plate_number) VALUES($1,$2,'TEST_ONLY','Fixture',$3) RETURNING id",
        [owner, profile, plate],
      )
    ).rows[0].id;
    extraVehicles.push(vehicle);
    expect((await accounts.getPartner(partner))?.vehicleCount).toBe(1);
    expect((await accounts.getVehicle(vehicle))?.partnerId).toBe(partner);
    expect((await accounts.getFleetAnalyticsSummary({ search: plate })).totalVehicles).toBe(1);
    const page = await accounts.getLiveFleetVehicles({ search: plate, page: 1, pageSize: 25 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.city).toBe('Unknown');
  });
  it('revokes legacy Admin reads immediately when the database account loses access', async () => {
    const app = express();
    app.use('/admin', createAdminRouter(new AdminController(new AdminService(accounts))));
    app.use(errorMiddleware);
    const token = await signAccessToken({ sub: admin, role: 'super_admin', type: 'access' });
    const get = () => request(app).get('/admin/users').set('Authorization', `Bearer ${token}`);
    expect((await get()).status).toBe(200);
    try {
      await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [admin]);
      expect((await get()).status).toBe(403);
      await pool.query("UPDATE users SET status='active', role='customer' WHERE id=$1", [admin]);
      expect((await get()).status).toBe(403);
      await pool.query("UPDATE users SET role='super_admin', deleted_at=NOW() WHERE id=$1", [
        admin,
      ]);
      expect((await get()).status).toBe(403);
    } finally {
      await pool.query(
        "UPDATE users SET status='active', role='super_admin',deleted_at=NULL WHERE id=$1",
        [admin],
      );
    }
  });
  it('includes combined driver/fleet accounts in driver management', async () => {
    const page = await accounts.listDrivers({
      page: 1,
      pageSize: 25,
      search: dual + '@example.invalid',
    });
    expect(page.items.some((row) => row.userId === dual)).toBe(true);
    expect(await accounts.getDriver(dual)).not.toBeNull();
  });
  for (const key of Object.keys(operationSources))
    it(`queries migrated ${key} without private projections`, async () => {
      const page = await repository.list(
        key as OperationModule,
        operationQuerySchema.parse({ pageSize: 2 }),
      );
      expect(Array.isArray(page.items)).toBe(true);
      expect(page.total).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(page)).not.toMatch(
        /"(?:password_hash|pin|payload|account_number_encrypted|provider_reference)"/,
      );
    });
  it('persists customer status and audit atomically; rejects admin targets', async () => {
    await accounts.updateUserStatus(customer, 'suspended', admin);
    expect((await accounts.getUser(customer))?.status).toBe('suspended');
    expect(
      (
        await pool.query(
          "SELECT metadata FROM user_history WHERE user_id=$1 AND event_type='user_status_updated'",
          [admin],
        )
      ).rows[0].metadata,
    ).toEqual({ previousStatus: 'active', status: 'suspended' });
    await expect(accounts.updateUserStatus(admin, 'banned', admin)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await accounts.getUser(admin))?.status).toBe('active');
    await accounts.updateUserStatus(customer, 'active', admin);
  });
  it('persists coupon creation and activation while rejecting stale updates', async () => {
    const input = adminCouponSchema.parse({
      code: 'T' + randomUUID().replaceAll('-', ''),
      discountType: 'FIXED',
      discountValue: 100,
      maxDiscountAmount: null,
      minFareAmount: 0,
      usageLimit: 3,
      perUserLimit: 1,
      startsAt: '2026-01-01T00:00:00Z',
      expiresAt: null,
      isActive: false,
    });
    const created = await promotion.manageByAdmin(admin, input);
    coupons.push(created.id);
    const version = (
      await pool.query('SELECT updated_at::text AS version FROM coupons WHERE id=$1', [created.id])
    ).rows[0].version;
    await promotion.manageByAdmin(
      admin,
      { isActive: true, expectedUpdatedAt: version },
      created.id,
    );
    expect((await promotion.findByCode(input.code))?.isActive).toBe(true);
    await expect(
      promotion.manageByAdmin(admin, { isActive: false, expectedUpdatedAt: version }, created.id),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await pool.query(
          "SELECT COUNT(*)::int AS count FROM user_history WHERE entity_id=$1 AND entity_type='coupon'",
          [created.id],
        )
      ).rows[0].count,
    ).toBe(2);
  });
  it('counts actual booking states and currency-specific captured receipts', async () => {
    const ride = (
      await pool.query(
        'INSERT INTO rides(customer_id,pickup_location,destination_location,fare_estimate) VALUES($1,ST_SetSRID(ST_Point(85.1,25.6),4326)::geography,ST_SetSRID(ST_Point(85.2,25.6),4326)::geography,123.45) RETURNING id',
        [customer],
      )
    ).rows[0].id;
    rides.push(ride);
    const legacy = await repository.list(
      'commission',
      operationQuerySchema.parse({ search: ride }),
    );
    expect(
      (legacy.items[0] as { booking_commission_paise: unknown }).booking_commission_paise,
    ).toBeNull();
    await pool.query(
      "UPDATE rides SET route_metadata=jsonb_build_object('bookingFareSnapshot',$2::jsonb) WHERE id=$1",
      [
        ride,
        JSON.stringify({
          grossAmount: 12345,
          commissionAmount: 321,
          driverEarnings: 12024,
          currency: 'INR',
        }),
      ],
    );
    const booked = await repository.list(
      'commission',
      operationQuerySchema.parse({ search: ride }),
    );
    expect(
      Number((booked.items[0] as { booking_commission_paise: unknown }).booking_commission_paise),
    ).toBe(321);
    const payment = (
      await pool.query(
        "INSERT INTO payments(user_id,ride_id,status,amount,currency,authorized_at,captured_at) VALUES($1,$2,'CAPTURED',123.45,'INR',NOW(),NOW()) RETURNING id",
        [customer, ride],
      )
    ).rows[0].id;
    payments.push(payment);
    const report = await repository.summary(undefined, undefined, true);
    expect(report.rides.some((r) => r.status === 'requested' && r.count >= 1)).toBe(true);
    expect(
      report.capturedPayments?.some((r) => r.currency === 'INR' && Number(r.amount) >= 123.45),
    ).toBe(true);
    expect((await repository.summary(undefined, undefined, false)).capturedPayments).toBeNull();
  });
});
