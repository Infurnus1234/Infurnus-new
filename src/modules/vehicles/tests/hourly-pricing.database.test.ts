import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { PostgresVehicleRepository } from '../repositories/vehicle.repository.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { AdminController } from '../../admin/controllers/admin.controller.js';
import { createAdminRouter } from '../../admin/routes/admin.routes.js';
import { AdminManagementService } from '../../admin/services/admin-management.service.js';
import { administrativePermissionGate } from '../../admin/middleware/permission.middleware.js';
import { RecordDeletionService } from '../../admin/services/record-deletion.service.js';
import { createRecordDeletionRouter } from '../../admin/routes/record-deletion.routes.js';
import { VehicleService } from '../services/vehicle.service.js';
import { VehicleController } from '../controllers/vehicle.controller.js';
import { createVehicleRouter } from '../routes/vehicle.routes.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { FareController } from '../../fares/controllers/fare.controller.js';
import { createFareRouter } from '../../fares/routes/fare.routes.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { RideService } from '../../rides/services/ride.service.js';
import { RideController } from '../../rides/controllers/ride.controller.js';
import { createRideRouter } from '../../rides/routes/ride.routes.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { HOURLY_FARE_BUCKETS } from '../services/hourly-pricing.js';
import type { VehicleType } from '../types/vehicle.js';

const schedule = Object.fromEntries(HOURLY_FARE_BUCKETS.map((key, i) => [key, 101 + i * 37]));
const fixedHourlyPricing = { hourlyRate: 500, fuelRate: 10, fuelUnit: 'per_km' as const };
const pickup = { latitude: 25.6, longitude: 85.1 },
  destination = { latitude: 26.12, longitude: 85.4 };
describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'Ride and Premium duration catalog on real PostgreSQL',
  () => {
    const vehicles = new PostgresVehicleRepository(pool),
      access = new AdminManagementService(pool),
      rides = new PostgresRideRepository(pool);
    const estimator = new FareEstimateService(
      {
        calculateRoute: async () => ({ distanceMeters: 10000, durationSeconds: 1200 }),
        calculateMatrix: async () => [],
        geocode: async () => null,
        places: async () => [],
      },
      new FareCalculatorService(),
      { allowFallback: false },
      vehicles,
    );
    const service = new RideService(rides, undefined, undefined, estimator);
    const app = express();
    app.use(express.json(), administrativePermissionGate(access));
    app.use('/admin/records', createRecordDeletionRouter(new RecordDeletionService(pool)));
    app.use(
      '/admin',
      createAdminRouter(
        new AdminController(new AdminService(new PostgresAdminRepository(pool), vehicles)),
      ),
    );
    app.use('/vehicles', createVehicleRouter(new VehicleController(new VehicleService(vehicles))));
    app.use('/fares', createFareRouter(new FareController(estimator)));
    app.use('/rides', createRideRouter(new RideController(service)));
    app.use(errorMiddleware);
    let superId: string,
      customerId: string,
      adminId: string,
      limitedId: string,
      superToken: string,
      adminToken: string,
      customerToken: string,
      limitedToken: string;
    const ids: string[] = [];
    async function create(sector = 'passenger', change: Record<string, unknown> = {}) {
      const res = await request(app)
        .post('/admin/vehicle-types')
        .auth(adminToken, { type: 'bearer' })
        .send({
          name: 'Hourly Test Vehicle',
          code: 'hourly_' + randomUUID().replaceAll('-', '').slice(0, 12),
          sector,
          ...(sector === 'premium'
            ? { baseFare: null, perKmRate: null, fixedHourlyPricing }
            : { baseFare: 73, perKmRate: 12, hourlyBaseFares: schedule }),
          active: true,
          ...change,
        });
      expect(res.status, res.text).toBe(201);
      ids.push(res.body.data.id);
      return res.body.data as VehicleType;
    }
    async function estimate(type: VehicleType, extra: Record<string, unknown> = {}) {
      return request(app)
        .post('/fares/estimate')
        .auth(customerToken, { type: 'bearer' })
        .send({ pickup, destination, sector: type.sector, vehicleCategory: type.code, ...extra });
    }
    beforeAll(async () => {
      requireDisposableAdministrativeDatabase();
      superId = (
        await pool.query(
          "INSERT INTO users(first_name,last_name,role) VALUES('HOURLY TEST','ONLY','super_admin') RETURNING id",
        )
      ).rows[0].id;
      customerId = (
        await pool.query(
          "INSERT INTO users(first_name,last_name,role) VALUES('HOURLY TEST','ONLY','customer') RETURNING id",
        )
      ).rows[0].id;
      const admin = await access.create(superId, {
        email: randomUUID() + '@example.invalid',
        password: 'Local-hourly-test-2026!',
        firstName: 'HOURLY TEST',
        lastName: 'ONLY',
        permissions: ['pricing.read', 'pricing.create', 'pricing.update', 'pricing.delete'],
      });
      adminId = admin.id;
      const limited = await access.create(superId, {
        email: randomUUID() + '@example.invalid',
        password: 'Local-hourly-test-2026!',
        firstName: 'HOURLY TEST',
        lastName: 'ONLY',
        permissions: ['pricing.read'],
      });
      limitedId = limited.id;
      [superToken, adminToken, customerToken, limitedToken] = (await Promise.all(
        [
          [superId, 'super_admin'],
          [adminId, 'admin'],
          [customerId, 'customer'],
          [limitedId, 'admin'],
        ].map(([sub, role]) => signAccessToken({ sub: sub!, role: role!, type: 'access' })),
      )) as [string, string, string, string];
    });
    afterAll(async () => {
      await pool.query('DELETE FROM rides WHERE customer_id=$1', [customerId]);
      await pool.query('DELETE FROM vehicle_types WHERE id=ANY($1::uuid[])', [ids]);
      const users = [superId, adminId, limitedId, customerId];
      await pool.query('DELETE FROM user_history WHERE user_id=ANY($1::uuid[])', [users]);
      // Keep ordinary administrative audit/identity relationships in this disposable database.
    });
    it.each(['passenger'] as const)('preserves independent %s duration pricing', async (sector) => {
      const type = await create(sector);
      expect(type.hourlyBaseFares).toEqual(schedule);
      for (const key of HOURLY_FARE_BUCKETS) {
        const hours = key === '12_plus' ? 13 : Number(key);
        const res = await estimate(type, { bookingHours: hours });
        expect(res.status, res.text).toBe(200);
        expect(res.body.data).toMatchObject({
          estimateType: 'range',
          currency: 'INR',
          bookable: true,
          oneWayDistanceMeters: 10000,
          distanceMeters: 10000,
          bookingFare: {
            baseAmount: schedule[key]! * 100,
            distanceAmount: 24000,
            grossAmount: schedule[key]! * 100 + 24000,
            vehicleConfiguration: {
              id: type.id,
              code: type.code,
              durationBucket: key,
              bookedHours: hours,
            },
          },
        });
        expect(res.body.data).not.toHaveProperty('billableDistanceMeters');
        expect(res.body.data.bookingFare).not.toHaveProperty('distanceMultiplier');
        expect(res.body.data.estimatedFare.minimum).not.toHaveProperty('billableDistanceMeters');
        expect(res.body.data.estimatedFare.maximum).not.toHaveProperty('billableDistanceMeters');
      }
      const old = await estimate(type);
      expect(old.status).toBe(422);
      expect(old.body.error.code).toBe('FARE_DURATION_REQUIRED');
      const customerCatalog = await request(app)
        .get('/vehicles/catalog?sector=' + sector)
        .auth(customerToken, { type: 'bearer' });
      expect(customerCatalog.status).toBe(200);
      expect(customerCatalog.body.data.some((v: VehicleType) => v.id === type.id)).toBe(true);
    });
    it('filters category before pagination and never changes another duration or vehicle', async () => {
      const a = await create(),
        b = await create('premium');
      const result = await request(app)
        .patch('/admin/vehicle-types/' + a.id)
        .auth(adminToken, { type: 'bearer' })
        .send({ expectedVersion: a.version, hourlyBaseFares: { '2': 500.29 }, perKmRate: 13.37 });
      expect(result.status, result.text).toBe(200);
      expect(result.body.data.hourlyBaseFares).toEqual({ ...schedule, '2': 500.29 });
      expect((await vehicles.getType(b.id))?.fixedHourlyPricing).toEqual(fixedHourlyPricing);
      const listed = await request(app)
        .get('/admin/vehicle-types?sector=premium&limit=1')
        .auth(adminToken, { type: 'bearer' });
      expect(listed.status).toBe(200);
      expect(listed.body.data.every((v: VehicleType) => v.sector === 'premium')).toBe(true);
      const changed = await estimate(result.body.data, { bookingHours: 2 });
      expect(changed.body.data.bookingFare).toMatchObject({
        baseAmount: 50029,
        grossAmount: 76800,
        roundingAdjustmentPaise: 31,
      });
      const same = await estimate(result.body.data, { bookingHours: 5 });
      expect(same.body.data.bookingFare.baseAmount).toBe(schedule['5']! * 100);
    });
    it('supports premium one-way and round-trip using the same selected duration', async () => {
      const type = await create('premium', {
        fixedHourlyPricing: { ...fixedHourlyPricing, fuelUnit: 'per_km', fuelRate: 12 },
      });
      for (const tripType of ['one_way', 'round_trip'] as const) {
        const res = await estimate(type, { rentalDetails: { hours: 6, tripType } });
        expect(res.status, res.text).toBe(200);
        expect(res.body.data.bookingFare.grossAmount).toBe(324000);
      }
    });
    it('rejects conflicting Premium durations and ignores stale Premium options on Ride requests', async () => {
      const premium = await create('premium'),
        ride = await create();
      const conflict = await estimate(premium, { bookingHours: 2, rentalDetails: { hours: 6 } });
      expect(conflict.status).toBe(422);
      expect(conflict.body.error.code).toBe('FARE_DURATION_CONFLICT');
      const booking = await request(app)
        .post('/rides')
        .auth(customerToken, { type: 'bearer' })
        .send({
          pickup,
          destination,
          sector: 'premium',
          vehicleCategory: premium.code,
          bookingHours: 2,
          rentalDetails: { hours: 6 },
        });
      expect(booking.status).toBe(422);
      const legacyRide = await estimate(ride, { rentalDetails: { hours: 6 } });
      expect(legacyRide.status).toBe(422);
      expect(legacyRide.body.error.code).toBe('FARE_DURATION_REQUIRED');
      const flat = await create('passenger', {
        hourlyBaseFares: null,
        extendedDurationPolicy: null,
      });
      const legacy = await estimate(flat);
      expect(legacy.status).toBe(200);
      expect(legacy.body.data.bookingFare.baseAmount).toBe(7300);
    });
    it('preserves confirmed snapshots across edits/deactivation and rejects stale or cross-vehicle quotes', async () => {
      const type = await create('premium'),
        other = await create('premium');
      const quote = (await estimate(type, { rentalDetails: { hours: 6, tripType: 'one_way' } }))
        .body.data;
      const body = {
        pickup,
        destination,
        sector: 'premium',
        vehicleCategory: type.code,
        rentalDetails: { hours: 6, tripType: 'one_way' },
        pricingQuote: {
          vehicleTypeId: type.id,
          pricingVersion: quote.pricingVersion,
          amountPaise: quote.bookingFare.grossAmount,
        },
      };
      const booked = await request(app)
        .post('/rides')
        .auth(customerToken, { type: 'bearer' })
        .send(body);
      expect(booked.status, booked.text).toBe(201);
      const saved = (
        await pool.query(
          "SELECT route_metadata->'bookingFareSnapshot' AS snapshot FROM rides WHERE id=$1",
          [booked.body.data.id],
        )
      ).rows[0].snapshot;
      expect(saved.vehicleConfiguration).toMatchObject({
        pricingModel: 'fixed_hourly',
        bookedHours: 6,
      });
      await vehicles.updateType(adminId, type.id, {
        expectedVersion: type.version,
        fixedHourlyPricing: { ...fixedHourlyPricing, hourlyRate: 999 },
        active: false,
      });
      const current = await rides.findById(booked.body.data.id);
      expect(Number(current?.fareEstimate)).toBe(quote.bookingFare.grossAmount / 100);
      expect(
        (
          await pool.query(
            "SELECT route_metadata->'bookingFareSnapshot' AS snapshot FROM rides WHERE id=$1",
            [booked.body.data.id],
          )
        ).rows[0].snapshot,
      ).toEqual(saved);
      expect((await estimate(type, { bookingHours: 6 })).status).toBe(422);
      const forged = await request(app)
        .post('/rides')
        .auth(customerToken, { type: 'bearer' })
        .send({ ...body, vehicleCategory: other.code });
      expect(forged.status).toBe(409);
      const deleted = await request(app)
        .delete('/admin/records/vehicle-types/' + type.id)
        .auth(adminToken, { type: 'bearer' })
        .send({ reason: 'TEST_ONLY dependency protection verification' });
      expect(deleted.status).toBe(409);
      expect((await vehicles.getType(type.id))?.active).toBe(false);
    });
    it('persists and updates a Rental tariff separately from Premium and passenger ride pricing', async () => {
      const rental = await create();
      const premium = await create('premium', { code: rental.code });
      const quote = (bookingHours: number) => estimate(rental, { sector: 'rental', bookingHours });
      expect((await quote(3)).body.error.code).toBe('FARE_CONFIGURATION_MISSING');
      const passengerQuote = await estimate(rental, { bookingHours: 3 });
      const patch = (rentalPricingVersion: number, pricing: Record<string, unknown>) =>
        request(app)
          .patch('/admin/vehicle-types/' + rental.id)
          .auth(adminToken, { type: 'bearer' })
          .send({
            expectedVersion: rental.version,
            expectedRentalPricingVersion: rentalPricingVersion,
            fixedHourlyPricing: pricing,
          });
      const rentalPrice = { hourlyRate: 430.25, fuelRate: 25, fuelUnit: 'per_hour' };
      const saved = await patch(rental.rentalPricingVersion!, rentalPrice);
      expect(saved.status, saved.text).toBe(200);
      expect((await vehicles.getType(rental.id))?.fixedHourlyPricing).toEqual(rentalPrice);
      const quoteBeforeUpdate = await quote(13);
      expect(quoteBeforeUpdate.status, quoteBeforeUpdate.text).toBe(200);
      expect(quoteBeforeUpdate.body.data.bookingFare).toMatchObject({
        baseAmount: 559325,
        fuelAmount: 32500,
        grossAmount: 591800,
      });
      const catalogue = await request(app)
        .get('/vehicles/catalog?sector=rental&limit=100')
        .auth(customerToken, { type: 'bearer' });
      const category = catalogue.body.data.find((item: VehicleType) => item.id === rental.id);
      expect(category).toMatchObject({ sector: 'rental', pricingStatus: 'available' });
      expect(category).not.toHaveProperty('fixedHourlyPricing');
      expect(
        (await patch(saved.body.data.rentalPricingVersion, { ...rentalPrice, fuelRate: -1 }))
          .status,
      ).toBe(400);
      const changed = await patch(saved.body.data.rentalPricingVersion, {
        ...rentalPrice,
        fuelRate: 0,
      });
      expect(changed.status, changed.text).toBe(200);
      expect((await patch(saved.body.data.rentalPricingVersion, rentalPrice)).status).toBe(409);
      const estimateAfter = await quote(13);
      expect(estimateAfter.body.data.bookingFare).toMatchObject({
        fuelAmount: 0,
        grossAmount: 559300,
      });
      const createRide = (fare: typeof quoteBeforeUpdate) =>
        request(app)
          .post('/rides')
          .auth(customerToken, { type: 'bearer' })
          .send({
            sector: 'rental',
            vehicleCategory: rental.code,
            pickup,
            destination,
            bookingHours: 13,
            pricingQuote: {
              vehicleTypeId: rental.id,
              pricingVersion: fare.body.data.pricingVersion,
              amountPaise: fare.body.data.bookingFare.grossAmount,
            },
          });
      expect((await createRide(quoteBeforeUpdate)).status).toBe(409);
      const booked = await createRide(estimateAfter);
      expect(booked.status, booked.text).toBe(201);
      expect(Number(booked.body.data.fareEstimate)).toBe(5593);
      expect((await estimate(premium, { bookingHours: 3 })).body.data.bookingFare.grossAmount).toBe(
        170000,
      );
      expect((await estimate(rental, { bookingHours: 3 })).body.data.bookingFare.baseAmount).toBe(
        schedule['3']! * 100,
      );
      expect((await estimate(rental, { bookingHours: 3 })).body.data.pricingVersion).toBe(
        passengerQuote.body.data.pricingVersion,
      );
    });
    it('rejects stale concurrent edits and allows deletion only without dependencies', async () => {
      const type = await create();
      const results = await Promise.all(
        [1, 2].map((n) =>
          request(app)
            .patch('/admin/vehicle-types/' + type.id)
            .auth(adminToken, { type: 'bearer' })
            .send({ expectedVersion: type.version, hourlyBaseFares: { '3': n * 111 } }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        (
          await request(app)
            .delete('/admin/records/vehicle-types/' + type.id)
            .auth(adminToken, { type: 'bearer' })
            .send({ reason: 'TEST_ONLY unused category deletion verification' })
        ).status,
      ).toBe(200);
      expect(await vehicles.getType(type.id)).toBeNull();
    });
    it('blocks incomplete activation, invalid amounts and hourly Logistics without changing its rates', async () => {
      const type = await create('passenger', { active: false, hourlyBaseFares: { '1': 0 } });
      expect(
        (
          await request(app)
            .patch('/admin/vehicle-types/' + type.id + '/status')
            .auth(adminToken, { type: 'bearer' })
            .send({ expectedVersion: type.version, active: true })
        ).status,
      ).toBe(422);
      for (const hourlyBaseFares of [{ '0': 1 }, { '2': -1 }, { '2': 1.001 }, { '2': '500' }]) {
        expect(
          (
            await request(app)
              .patch('/admin/vehicle-types/' + type.id)
              .auth(adminToken, { type: 'bearer' })
              .send({ expectedVersion: type.version, hourlyBaseFares })
          ).status,
        ).toBe(400);
      }
      const logistics = await create('logistics', {
        hourlyBaseFares: null,
        extendedDurationPolicy: null,
      });
      expect(
        (
          await request(app)
            .patch('/admin/vehicle-types/' + logistics!.id)
            .auth(adminToken, { type: 'bearer' })
            .send({ expectedVersion: logistics!.version, hourlyBaseFares: schedule })
        ).status,
      ).toBe(422);
      expect(JSON.parse(JSON.stringify(await vehicles.getType(logistics!.id)))).toEqual(logistics);
    });
    it('requires whole-hour Premium durations and prices the full extended duration', async () => {
      const type = await create('premium');
      const missing = await estimate(type);
      expect(missing.status).toBe(422);
      expect(missing.body.error.code).toBe('FARE_DURATION_REQUIRED');
      const fraction = await estimate(type, { bookingHours: 1.2 });
      expect(fraction.status).toBe(422);
      expect(fraction.body.error.code).toBe('FARE_DURATION_INVALID');
      for (const hours of Array.from({ length: 12 }, (_, i) => i + 13)) {
        const extended = await estimate(type, { bookingHours: hours });
        expect(extended.status, extended.text).toBe(200);
        expect(extended.body.data.bookingFare.baseAmount).toBe(50000 * hours);
        expect(extended.body.data.bookingFare.vehicleConfiguration.bookedHours).toBe(hours);
      }
      expect((await estimate(type, { bookingHours: 25 })).status).toBe(422);
      expect((await estimate(type, { bookingHours: 48 })).status).toBe(422);
    });
    it('preserves the approved duration policy for ordinary passenger schedules', async () => {
      const type = await create();
      for (const policy of [
        { missingDurationPolicy: 'legacy_base' },
        { extendedDurationPolicy: null },
      ]) {
        const invalid = await request(app)
          .patch('/admin/vehicle-types/' + type.id)
          .auth(adminToken, { type: 'bearer' })
          .send({ expectedVersion: type.version, ...policy });
        expect(invalid.status, invalid.text).toBe(422);
      }
    });
    it('enforces authentication, active Admin grants and Super Admin access', async () => {
      const type = await create();
      expect((await request(app).get('/admin/vehicle-types')).status).toBe(401);
      for (const token of [customerToken, limitedToken])
        expect(
          (
            await request(app)
              .patch('/admin/vehicle-types/' + type.id)
              .auth(token, { type: 'bearer' })
              .send({ expectedVersion: type.version, name: 'Not allowed' })
          ).status,
        ).toBe(403);
      expect(
        (
          await request(app)
            .get('/admin/vehicle-types?sector=passenger')
            .auth(limitedToken, { type: 'bearer' })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .get('/admin/vehicle-types?sector=premium')
            .auth(superToken, { type: 'bearer' })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .get('/vehicles/catalog?sector=logistics')
            .auth(customerToken, { type: 'bearer' })
        ).status,
      ).toBe(200);
    });
  },
);
