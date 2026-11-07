import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { randomUUID, createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { PostgresVehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { PostgresPaymentRepository } from '../repositories/payment.repository.js';
import { LogisticsPaymentService } from '../services/logistics-payment.service.js';
import { PaymentController } from '../controllers/payment.controller.js';
import { createPaymentRouter } from '../routes/payment.routes.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { RideService } from '../../rides/services/ride.service.js';
import { CashfreePaymentProvider } from '../providers/cashfree.provider.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import type { PaymentProvider, PaymentStatusResult } from '../providers/payment.provider.js';
import { createLogisticsAdminRouter } from '../../admin/routes/logistics.routes.js';
import { AdminManagementService } from '../../admin/services/admin-management.service.js';
import { administrativePermissionGate } from '../../admin/middleware/permission.middleware.js';
import { createAdminRouter } from '../../admin/routes/admin.routes.js';
import { AdminController } from '../../admin/controllers/admin.controller.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';
const secret = 'isolated-test-webhook-secret';
describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'Logistics slabs and stage payments on PostgreSQL',
  () => {
    const vehicles = new PostgresVehicleRepository(pool),
      rides = new PostgresRideRepository(pool),
      payments = new PostgresPaymentRepository(pool);
    let distance = 10000;
    const estimator = new FareEstimateService(
      {
        calculateRoute: async () => ({ distanceMeters: distance, durationSeconds: 1200 }),
        calculateMatrix: async () => [],
        geocode: async () => null,
        places: async () => [],
      },
      new FareCalculatorService(),
      { allowFallback: false },
      vehicles,
    );
    const rideService = new RideService(
      rides,
      new PostgresDriverRepository(pool),
      undefined,
      estimator,
    );
    const orders = new Map<string, { amount: number; currency: string }>();
    let status: PaymentStatusResult['orderStatus'] = 'ACTIVE',
      wrongAmount = false;
    const verifier = new CashfreePaymentProvider({ clientId: 'isolated', clientSecret: secret });
    const provider: PaymentProvider = {
      providerName: 'cashfree',
      createOrder: async (p) => {
        orders.set(p.orderId, { amount: p.amount, currency: p.currency });
        return {
          providerOrderId: p.orderId,
          orderAmount: p.amount,
          orderCurrency: p.currency,
          orderStatus: 'ACTIVE',
          entity: 'order',
          paymentSessionId: 'isolated-session',
        };
      },
      getPaymentStatus: async (id) => ({
        providerOrderId: id,
        orderStatus: status,
        orderAmount: orders.get(id)!.amount + (wrongAmount ? 1 : 0),
        orderCurrency: 'INR',
        providerPaymentId: status === 'PAID' ? 'verified_' + id : null,
      }),
      verifyWebhookSignature: (...args) => verifier.verifyWebhookSignature(...args),
    };
    const logistics = new LogisticsPaymentService(pool, payments, provider);
    const access = new AdminManagementService(pool);
    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as express.Request & { rawBody?: string }).rawBody = buf.toString();
        },
      }),
      administrativePermissionGate(access),
    );
    app.use(
      '/payments',
      createPaymentRouter(new PaymentController(payments, rides, undefined, provider, logistics)),
    );
    app.use('/admin/logistics', createLogisticsAdminRouter(pool));
    app.use(
      '/admin',
      createAdminRouter(
        new AdminController(new AdminService(new PostgresAdminRepository(pool), vehicles)),
      ),
    );
    app.use(errorMiddleware);
    let customer: string,
      driver: string,
      other: string,
      superId: string,
      profile: string,
      vehicle: string,
      customerToken: string,
      driverToken: string,
      otherToken: string,
      superToken: string,
      limitedToken: string,
      adminToken: string;
    const rideIds: string[] = [],
      typeIds: string[] = [];
    const slabs = {
      below_15: { baseFare: 101.01, perKmRate: 11.11 },
      from_15: { baseFare: 202.02, perKmRate: 22.22 },
    };
    async function createType(extra: Record<string, unknown> = {}) {
      const response = await request(app)
        .post('/admin/vehicle-types')
        .auth(adminToken, { type: 'bearer' })
        .send({
          name: 'Logistics Test',
          code: 'lg_' + randomUUID().replaceAll('-', '').slice(0, 15),
          sector: 'logistics',
          baseFare: null,
          perKmRate: null,
          logisticsSlabs: slabs,
          active: true,
          ...extra,
        });
      expect(response.status, response.text).toBe(201);
      typeIds.push(response.body.data.id);
      return response.body.data;
    }
    async function booking(type?: Awaited<ReturnType<typeof createType>>) {
      const previous = await pool.query(
        "SELECT id,status FROM rides WHERE assigned_driver_id=$1 AND status NOT IN ('completed','cancelled')",
        [profile],
      );
      for (const row of previous.rows) {
        if (row.status === 'in_progress') await rideService.completeRide(row.id, profile);
        else
          await pool.query(
            "UPDATE rides SET status='cancelled',cancelled_at=NOW(),cancellation_reason='test fixture finished' WHERE id=$1",
            [row.id],
          );
      }
      await pool.query("UPDATE driver_profiles SET availability_status='available' WHERE id=$1", [
        profile,
      ]);
      const t = type ?? (await createType());
      distance = 10000;
      const ride = await rideService.createRide(customer, {
        sector: 'logistics',
        vehicleCategory: t.code,
        pickup: { latitude: 25.6, longitude: 85.1 },
        destination: { latitude: 26.12, longitude: 85.4 },
      });
      rideIds.push(ride.id);
      await pool.query(
        "UPDATE rides SET assigned_driver_id=$2,assigned_vehicle_id=$3,status='driver_assigned' WHERE id=$1",
        [ride.id, profile, vehicle],
      );
      await pool.query("UPDATE driver_profiles SET availability_status='busy' WHERE id=$1", [
        profile,
      ]);
      return ride;
    }
    const initiate = (id: string, method = 'cash', stage?: string, token = customerToken) =>
      request(app)
        .post('/payments/initiate')
        .auth(token, { type: 'bearer' })
        .send({ rideId: id, provider: method, amount: 0.01, ...(stage ? { stage } : {}) });
    const capture = (id: string, token = driverToken) =>
      request(app)
        .post('/payments/' + id + '/capture')
        .auth(token, { type: 'bearer' })
        .send({});
    beforeAll(async () => {
      requireDisposableAdministrativeDatabase();
      const user = async (role: string) =>
        (
          await pool.query(
            "INSERT INTO users(first_name,last_name,role) VALUES('LOGISTICS TEST','ONLY',$1) RETURNING id",
            [role],
          )
        ).rows[0].id;
      customer = await user('customer');
      driver = await user('driver');
      other = await user('customer');
      superId = await user('super_admin');
      profile = (
        await pool.query(
          "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status) VALUES($1,$2,CURRENT_DATE+365,'approved') RETURNING id",
          [driver, randomUUID()],
        )
      ).rows[0].id;
      vehicle = (
        await pool.query(
          "INSERT INTO vehicles(driver_profile_id,owner_id,make,model,plate_number,verification_status,is_active) VALUES($1,$2,'Test','Logistics',$3,'approved',TRUE) RETURNING id",
          [profile, driver, randomUUID().slice(0, 15)],
        )
      ).rows[0].id;
      await pool.query('UPDATE driver_profiles SET active_vehicle_id=$2 WHERE id=$1', [
        profile,
        vehicle,
      ]);
      const admin = await access.create(superId, {
        email: randomUUID() + '@example.invalid',
        password: 'Local-logistics-2026!',
        firstName: 'Logistics',
        lastName: 'Admin',
        permissions: [
          'pricing.read',
          'pricing.create',
          'pricing.update',
          'logistics.read',
          'payments.read',
        ],
      });
      const limited = await access.create(superId, {
        email: randomUUID() + '@example.invalid',
        password: 'Local-logistics-2026!',
        firstName: 'Limited',
        lastName: 'Admin',
        permissions: ['pricing.read'],
      });
      const tokens = await Promise.all(
        [
          [customer, 'customer'],
          [driver, 'driver'],
          [other, 'customer'],
          [superId, 'super_admin'],
          [admin.id, 'admin'],
          [limited.id, 'admin'],
        ].map(([sub, role]) => signAccessToken({ sub: sub!, role: role!, type: 'access' })),
      );
      [customerToken, driverToken, otherToken, superToken, adminToken, limitedToken] = tokens as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
    });
    afterAll(async () => {
      await pool.query('DELETE FROM payments WHERE ride_id=ANY($1::uuid[])', [rideIds]);
      await pool.query('DELETE FROM rides WHERE id=ANY($1::uuid[])', [rideIds]);
      await pool.query('DELETE FROM vehicle_types WHERE id=ANY($1::uuid[])', [typeIds]);
    });
    it('selects exactly one slab for 2, 5, 10, 14.999, 15 and 20 km with no return-distance multiplier', async () => {
      const t = await createType();
      for (const meters of [2000, 5000, 10000, 14999, 15000, 20000]) {
        distance = meters;
        const f = await estimator.estimate(
          { latitude: 25.6, longitude: 85.1 },
          { latitude: 26.12, longitude: 85.4 },
          { sector: 'logistics', vehicleCategory: t.code, pricingMode: 'vehicle_range' },
        );
        if (!('bookingFare' in f)) throw Error('Missing fare');
        const rate = meters < 15000 ? slabs.below_15 : slabs.from_15;
        expect(f.bookingFare?.grossAmount).toBe(
          Math.round(
            (Math.round(rate.baseFare * 100) + Math.round((meters * rate.perKmRate * 100) / 1000)) /
              100,
          ) * 100,
        );
        expect(f.bookingFare?.billableDistanceMeters).toBe(meters);
        expect(f.bookingFare?.distanceMultiplier).toBe(1);
        expect(f.bookingFare?.logisticsPayment?.upfrontPaise).toBe(
          Math.round((f.bookingFare!.grossAmount * 0.4) / 100) * 100,
        );
      }
    });
    it('persists independent slabs, enforces versions and isolates other vehicles and sectors', async () => {
      const a = await createType(),
        b = await createType();
      const update = await request(app)
        .patch('/admin/vehicle-types/' + a.id)
        .auth(adminToken, { type: 'bearer' })
        .send({
          expectedVersion: a.version,
          logisticsSlabs: { ...slabs, below_15: { baseFare: 123.45, perKmRate: 15.67 } },
        });
      expect(update.status, update.text).toBe(200);
      expect((await vehicles.getType(a.id))?.logisticsSlabs?.from_15).toEqual(slabs.from_15);
      expect((await vehicles.getType(b.id))?.logisticsSlabs).toEqual(slabs);
      expect(
        (
          await request(app)
            .patch('/admin/vehicle-types/' + a.id)
            .auth(adminToken, { type: 'bearer' })
            .send({ expectedVersion: a.version, name: 'stale' })
        ).status,
      ).toBe(409);
      for (const bad of [
        { sector: 'passenger' },
        { logisticsSlabs: { below_15: { baseFare: -1, perKmRate: 1 }, from_15: slabs.from_15 } },
        { logisticsSlabs: { below_15: slabs.below_15 } },
      ]) {
        expect(
          (
            await request(app)
              .post('/admin/vehicle-types')
              .auth(adminToken, { type: 'bearer' })
              .send({
                name: 'Invalid',
                code: 'invalid_' + randomUUID().slice(0, 8),
                sector: 'logistics',
                baseFare: null,
                perKmRate: null,
                active: true,
                logisticsSlabs: slabs,
                ...bad,
              })
          ).status,
        ).toBeGreaterThanOrEqual(400);
      }
    });
    it('locks historical fares and payment amounts after Admin edits and deactivation', async () => {
      const type = await createType(),
        ride = await booking(type);
      await vehicles.updateType(superId, type.id, {
        expectedVersion: type.version,
        logisticsSlabs: { below_15: { baseFare: 999, perKmRate: 99 }, from_15: slabs.from_15 },
        active: false,
      });
      const saved = await rides.findByIdForCustomer(ride.id, customer);
      expect(Number(saved?.fareEstimate)).toBe(212);
      const sum = await logistics.summary(ride.id, customer, 'customer');
      expect(sum.totalPaise).toBe(21200);
      expect(sum.upfrontPaise).toBe(8500);
      expect(sum.finalPaise).toBe(12700);
    });
    it('records customer cash claims without confirming receipt and gates pickup PIN until assigned driver receipt', async () => {
      const ride = await booking();
      const p = await initiate(ride.id);
      expect(p.status, p.text).toBe(201);
      expect(Number(p.body.data.amount)).toBe(85);
      expect((await capture(p.body.data.id)).status).toBe(409);
      const claim = await capture(p.body.data.id, customerToken);
      expect(claim.status, claim.text).toBe(200);
      expect(claim.body.data.status).toBe('INITIATED');
      expect(claim.body.data.customerClaimedAt).toBeTruthy();
      await rides.transition(ride.id, 'driver_arriving', profile);
      await rides.transition(ride.id, 'driver_arrived', profile);
      await expect(rides.verifyPinAttempt(ride.id, profile, '0000')).rejects.toMatchObject({
        code: 'LOGISTICS_UPFRONT_REQUIRED',
      });
      await expect(
        pool.query("UPDATE rides SET status='in_progress',pin_verified=TRUE WHERE id=$1", [
          ride.id,
        ]),
      ).rejects.toThrow(/upfront/i);
      expect((await capture(p.body.data.id, otherToken)).status).toBe(403);
      const receipt = await capture(p.body.data.id);
      expect(receipt.status, receipt.text).toBe(200);
      expect(receipt.body.data.status).toBe('CAPTURED');
      expect(receipt.body.data.cashConfirmedBy).toBe(driver);
      const current = await rides.findByIdForCustomer(ride.id, customer);
      expect(await rides.verifyPinAttempt(ride.id, profile, current!.pin!)).toBe('verified');
      expect((await rides.findById(ride.id))?.status).toBe('in_progress');
      expect((await logistics.summary(ride.id, customer, 'customer')).outstandingPaise).toBe(12700);
    });
    it('allows delivery with outstanding final balance and settles only after customer claim and final cash receipt', async () => {
      const ride = await booking();
      const p = await initiate(ride.id);
      await capture(p.body.data.id, customerToken);
      await capture(p.body.data.id);
      expect((await initiate(ride.id, 'cash', 'final')).status).toBe(409);
      await rides.transition(ride.id, 'driver_arriving', profile);
      await rides.transition(ride.id, 'driver_arrived', profile);
      const pin = (await rides.findByIdForCustomer(ride.id, customer))!.pin!;
      await rides.verifyPinAttempt(ride.id, profile, pin);
      await rideService.completeRide(ride.id, profile);
      let summary = await logistics.summary(ride.id, customer, 'customer');
      expect(summary.deliveryStatus).toBe('completed');
      expect(summary.settlementStatus).toBe('outstanding');
      const final = await initiate(ride.id);
      expect(final.status, final.text).toBe(201);
      expect(final.body.data.paymentStage).toBe('final');
      expect(Number(final.body.data.amount)).toBe(127);
      await capture(final.body.data.id, customerToken);
      await capture(final.body.data.id);
      await capture(final.body.data.id);
      summary = await logistics.summary(ride.id, customer, 'customer');
      expect(summary.confirmedPaise).toBe(21200);
      expect(summary.outstandingPaise).toBe(0);
      expect(summary.settlementStatus).toBe('settled');
      expect(Number((await rides.findById(ride.id))?.finalFare)).toBe(212);
    });
    it('rejects unsupported methods, premature payments, wrong owners and mismatched stage amounts', async () => {
      const ride = await booking();
      expect((await initiate(ride.id, 'cash', undefined, otherToken)).status).toBe(403);
      expect((await initiate(ride.id, 'wallet')).status).toBe(422);
      expect(
        (
          await request(app)
            .get('/payments/rides/' + ride.id + '/summary')
            .auth(otherToken, { type: 'bearer' })
        ).status,
      ).toBe(403);
      await expect(
        pool.query(
          "INSERT INTO payments(user_id,ride_id,amount,provider,payment_stage) VALUES($1,$2,1,'cash','upfront')",
          [customer, ride.id],
        ),
      ).rejects.toThrow(/amount mismatch/);
    });
    it('converges duplicate cash requests and claims on one auditable stage', async () => {
      const ride = await booking();
      const results = await Promise.all([initiate(ride.id), initiate(ride.id)]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results[0].body.data.id).toBe(results[1].body.data.id);
      const id = results[0].body.data.id;
      await Promise.all([capture(id, customerToken), capture(id, customerToken)]);
      await Promise.all([capture(id), capture(id)]);
      const events = await pool.query(
        'SELECT event_type,count(*)::int n FROM logistics_payment_events WHERE payment_id=$1 GROUP BY event_type',
        [id],
      );
      expect(Object.fromEntries(events.rows.map((r) => [r.event_type, r.n]))).toEqual({
        initiated: 1,
        customer_claimed: 1,
        captured: 1,
      });
    });
    it('requires trusted online verification and rejects pending, wrong amounts, forged success and manual Driver capture', async () => {
      const ride = await booking();
      const p = await initiate(ride.id, 'cashfree');
      expect(p.status, p.text).toBe(201);
      status = 'ACTIVE';
      expect((await capture(p.body.data.id, customerToken)).status).toBe(400);
      expect((await capture(p.body.data.id)).status).toBe(403);
      status = 'PAID';
      wrongAmount = true;
      expect((await capture(p.body.data.id, customerToken)).status).toBe(400);
      wrongAmount = false;
      const paid = await capture(p.body.data.id, customerToken);
      expect(paid.status, paid.text).toBe(200);
      expect(paid.body.data.providerPaymentId).toBe('verified_' + p.body.data.providerOrderId);
      expect((await logistics.summary(ride.id, customer, 'customer')).confirmedPaise).toBe(8500);
      status = 'ACTIVE';
    });
    it('validates signed Cashfree callback identity, currency and amount; duplicate callbacks cannot double count', async () => {
      const ride = await booking();
      const p = await initiate(ride.id, 'cashfree');
      const event = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: { order_id: p.body.data.providerOrderId, order_currency: 'INR' },
          payment: {
            cf_payment_id: 'webhook_' + p.body.data.id,
            payment_status: 'SUCCESS',
            payment_amount: 85,
            payment_currency: 'INR',
          },
        },
      };
      const send = (body: unknown, valid = true) => {
        const raw = JSON.stringify(body),
          timestamp = String(Date.now()),
          signature = createHmac('sha256', secret)
            .update(timestamp + raw)
            .digest('base64');
        return request(app)
          .post('/payments/webhooks/cashfree')
          .set('Content-Type', 'application/json')
          .set('x-webhook-timestamp', timestamp)
          .set('x-webhook-signature', valid ? signature : 'forged')
          .send(raw);
      };
      expect((await send(event, false)).status).toBe(401);
      expect(
        (
          await send({
            ...event,
            data: { ...event.data, payment: { ...event.data.payment, payment_amount: 1 } },
          })
        ).status,
      ).toBe(400);
      for (let i = 0; i < 2; i++) {
        const res = await send(event);
        expect(res.status, res.text).toBe(200);
      }
      expect((await logistics.summary(ride.id, customer, 'customer')).confirmedPaise).toBe(8500);
    });
    it('returns only real Logistics plans in the permission-protected Admin ledger and applies filters', async () => {
      const admin = await request(app)
        .get('/admin/logistics/payments?method=cash&deliveryStatus=completed&settlement=settled')
        .auth(adminToken, { type: 'bearer' });
      expect(admin.status, admin.text).toBe(200);
      expect(admin.body.data.items.length).toBeGreaterThan(0);
      expect(
        admin.body.data.items.some((r: any) =>
          r.payments.some((p: any) => p.cashConfirmedBy === driver),
        ),
      ).toBe(true);
      expect(
        admin.body.data.items.every(
          (r: any) =>
            r.deliveryStatus === 'completed' &&
            r.settlementStatus === 'settled' &&
            r.payments.some((p: any) => p.cashConfirmedBy != null),
        ),
      ).toBe(true);
      expect(
        (await request(app).get('/admin/logistics/payments').auth(limitedToken, { type: 'bearer' }))
          .status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get('/admin/logistics/payments')
            .auth(customerToken, { type: 'bearer' })
        ).status,
      ).toBe(403);
      expect(
        (await request(app).get('/admin/logistics/payments').auth(superToken, { type: 'bearer' }))
          .status,
      ).toBe(200);
    });
  },
);
