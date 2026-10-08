import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { AdminController } from '../../admin/controllers/admin.controller.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';
import { createAdminRouter } from '../../admin/routes/admin.routes.js';
import { PostgresVehicleRepository } from '../repositories/vehicle.repository.js';
import { createVehicleTypeSchema, updateVehicleTypeSchema } from '../schemas/vehicle.schemas.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FareController } from '../../fares/controllers/fare.controller.js';
import { createFareRouter } from '../../fares/routes/fare.routes.js';
import { RideController } from '../../rides/controllers/ride.controller.js';
import { createRideRouter } from '../../rides/routes/ride.routes.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { RideService } from '../../rides/services/ride.service.js';
import { sanitizeRideForDriver } from '../../rides/utils/ride-sanitizer.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
import type { VehicleType } from '../types/vehicle.js';
import type { FareCalculationResult } from '../../fares/types/fare.js';
import { VEHICLE_FARE_PRICING } from '../../fares/config/fare.config.js';

const payload = {
  name: 'XYZ',
  code: 'xyz',
  sector: 'passenger',
  baseFare: 100,
  perKmRate: 15,
  currency: 'INR',
  active: false,
};
const booking = {
  pickup: { latitude: 12.9716, longitude: 77.5946 },
  destination: { latitude: 12.9352, longitude: 77.6245 },
  sector: 'passenger' as const,
  vehicleCategory: 'xyz',
  fareEstimate: 1,
};
const routes: MapProvider = {
  calculateRoute: async () => ({ distanceMeters: 10000, durationSeconds: 1200 }),
  calculateMatrix: async () => [],
  geocode: async () => null,
  places: async () => [],
};

describe('strict admin vehicle pricing input', () => {
  it.each([
    { baseFare: -1 },
    { perKmRate: -1 },
    { baseFare: NaN },
    { baseFare: Infinity },
    { baseFare: 1.001 },
    { perKmRate: 1.0000000001 },
    { name: '' },
    { code: 'XYZ' },
    { code: 'x-y' },
    { sector: 'rental' },
    { sector: 'bogus' },
    { currency: 'USD' },
    { baseFare: undefined },
    { perKmRate: undefined },
    { finalFare: 1 },
  ])('rejects invalid config %j', (change) => {
    expect(createVehicleTypeSchema.safeParse({ ...payload, ...change }).success).toBe(false);
  });
  it('supports exact paise, zero explicit rates and strict optimistic updates', () => {
    expect(
      createVehicleTypeSchema.parse({ ...payload, baseFare: 0.29, perKmRate: 0 }).baseFare,
    ).toBe(0.29);
    expect(updateVehicleTypeSchema.safeParse({ baseFare: 120 }).success).toBe(false);
    expect(updateVehicleTypeSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(updateVehicleTypeSchema.safeParse({ expectedVersion: 1, code: 'change' }).success).toBe(
      false,
    );
  });
});
const live = process.env.RIDE_DB_TESTS === 'true' ? describe : describe.skip;
live('admin catalog → existing fare/booking → MAP3 real PostgreSQL', () => {
  const vehicles = new PostgresVehicleRepository(pool),
    rides = new PostgresRideRepository(pool),
    drivers = new PostgresDriverRepository(pool);
  const admin = new AdminService(new PostgresAdminRepository(pool), vehicles);
  const estimator = new FareEstimateService(
    routes,
    new FareCalculatorService(),
    undefined,
    vehicles,
  );
  const service = new RideService(rides, drivers, undefined, estimator);
  let adminId: string, customerId: string, driverId: string, profileId: string, vehicleId: string;
  let app: ReturnType<typeof express>;
  const ids: string[] = [];
  async function token(role = 'admin', id = adminId) {
    return signAccessToken({ sub: id, role, type: 'access' });
  }
  async function create(data = payload): Promise<VehicleType> {
    const t = await admin.createVehicleType(adminId, data);
    ids.push(t.id);
    return t;
  }
  beforeEach(async () => {
    for (const role of ['admin', 'customer', 'driver']) {
      const u = await pool.query(
        "INSERT INTO users(first_name,last_name,phone,role) VALUES('Dynamic','Fare',$1,$2) RETURNING id",
        ['+96' + randomUUID().replaceAll('-', '').slice(0, 10), role],
      );
      if (role === 'admin') adminId = u.rows[0].id;
      else if (role === 'customer') customerId = u.rows[0].id;
      else driverId = u.rows[0].id;
    }
    const p = await pool.query(
      "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status,availability_status,last_location,last_location_at) VALUES($1,$2,CURRENT_DATE+365,'approved','available',ST_SetSRID(ST_MakePoint(77.5946,12.9716),4326)::geography,$3) RETURNING id",
      [driverId, randomUUID(), new Date(Date.now() - 1000)],
    );
    profileId = p.rows[0].id;
    const v = await pool.query(
      "INSERT INTO vehicles(driver_profile_id,make,model,plate_number,verification_status,category,is_active) VALUES($1,'XYZ','Test',$2,'approved','xyz',TRUE) RETURNING id",
      [profileId, randomUUID().slice(0, 18)],
    );
    vehicleId = v.rows[0].id;
    app = express();
    app.use(express.json());
    app.use('/admin', createAdminRouter(new AdminController(admin)));
    app.use('/fares', createFareRouter(new FareController(estimator)));
    app.use('/rides', createRideRouter(new RideController(service)));
    app.use(errorMiddleware);
  });
  afterEach(async () => {
    await pool.query('DELETE FROM rides WHERE customer_id=$1', [customerId]);
    await pool.query('DELETE FROM vehicles WHERE id=$1', [vehicleId]);
    await pool.query('DELETE FROM driver_profiles WHERE id=$1', [profileId]);
    await pool.query('DELETE FROM vehicle_types WHERE id=ANY($1::uuid[])', [ids.splice(0)]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
      [adminId, customerId, driverId],
    ]);
  });
  it('real HTTP create, activate, estimate, book, update; historical fare reaches both MAP3 views', async () => {
    const auth = await token();
    const created = await request(app)
      .post('/admin/vehicle-types')
      .set('authorization', 'Bearer ' + auth)
      .send(payload);
    expect(created.status).toBe(201);
    const type = created.body.data;
    ids.push(type.id);
    expect(
      (
        await request(app)
          .get('/admin/vehicle-types/' + type.id)
          .set('authorization', 'Bearer ' + auth)
      ).body.data.baseFare,
    ).toBe(100);
    expect(
      (
        await request(app)
          .get('/admin/vehicle-types')
          .set('authorization', 'Bearer ' + auth)
      ).body.data.some((v: VehicleType) => v.id === type.id),
    ).toBe(true);
    await expect(service.createRide(customerId, booking)).rejects.toMatchObject({
      code: 'FARE_CONFIGURATION_MISSING',
    });
    const activated = await request(app)
      .patch('/admin/vehicle-types/' + type.id + '/status')
      .set('authorization', 'Bearer ' + auth)
      .send({ active: true, expectedVersion: 1 });
    expect(activated.status).toBe(200);
    const customerAuth = await token('customer', customerId);
    const estimate = await request(app)
      .post('/fares/estimate')
      .set('authorization', 'Bearer ' + customerAuth)
      .send(booking);
    // The estimate API deliberately rejects booking-only client fareEstimate.
    expect(estimate.status).toBe(400);
    const { fareEstimate: _ignored, ...estimateInput } = booking;
    const valid = await request(app)
      .post('/fares/estimate')
      .set('authorization', 'Bearer ' + customerAuth)
      .send(estimateInput);
    expect(valid.status).toBe(200);
    expect(valid.body.data.bookingFare.grossAmount).toBe(25000);
    const booked = await request(app)
      .post('/rides')
      .set('authorization', 'Bearer ' + customerAuth)
      .send(booking);
    expect(booked.status).toBe(201);
    expect(booked.body.data.fareEstimate).toBe(250);
    const first = booked.body.data.id;
    expect(await rides.offerDispatch(first, profileId, 60000)).toBe(true);
    await service.acceptRide(profileId, first);
    expect((await service.getUserMap(customerId, first)).fare.bookedAmount).toBe(250);
    expect((await service.getDriverMap(driverId, first)).fare.bookedAmount).toBe(250);
    const sanitized = sanitizeRideForDriver((await rides.findById(first))!);
    expect(sanitized.rideInformation.fare.bookedAmount).toBe(250);
    const changed = await request(app)
      .patch('/admin/vehicle-types/' + type.id)
      .set('authorization', 'Bearer ' + auth)
      .send({ baseFare: 120, perKmRate: 18, expectedVersion: 2 });
    expect(changed.status).toBe(200);
    const second = await service.createRide(customerId, booking);
    expect(second.fareEstimate).toBe(300);
    expect((await service.getUserMap(customerId, first)).fare.bookedAmount).toBe(250);
    expect((await service.getDriverMap(driverId, first)).fare.bookedAmount).toBe(250);
    const persisted = await pool.query('SELECT route_metadata FROM rides WHERE id=$1', [first]);
    expect(persisted.rows[0].route_metadata.bookingFareSnapshot.vehicleConfiguration).toMatchObject(
      { version: 2, baseFarePaise: 10000, perKmRatePaise: 1500 },
    );
    const audit = await pool.query(
      'SELECT metadata FROM user_history WHERE user_id=$1 AND entity_id=$2 ORDER BY created_at',
      [adminId, type.id],
    );
    expect(audit.rowCount).toBe(3);
    expect(audit.rows[2].metadata).toMatchObject({
      old: { baseFare: 100 },
      new: { baseFare: 120 },
    });
  });
  it.each(['customer', 'driver', 'fleet_owner', 'driver_fleet_owner'])(
    'denies %s on all mutation surfaces',
    async (role) => {
      const auth = await token(role, customerId);
      for (const path of [
        '/admin/vehicle-types',
        '/admin/vehicle-types/' + randomUUID(),
        '/admin/vehicle-types/' + randomUUID() + '/status',
      ]) {
        const response =
          path === '/admin/vehicle-types'
            ? await request(app)
                .post(path)
                .set('authorization', 'Bearer ' + auth)
                .send(payload)
            : await request(app)
                .patch(path)
                .set('authorization', 'Bearer ' + auth)
                .send({ active: true, expectedVersion: 1 });
        expect(response.status).toBe(403);
      }
      expect((await request(app).post('/admin/vehicle-types').send(payload)).status).toBe(401);
    },
  );
  it('allows existing super_admin and rejects revoked database admin despite signed token', async () => {
    await pool.query("UPDATE users SET role='super_admin' WHERE id=$1", [adminId]);
    const response = await request(app)
      .post('/admin/vehicle-types')
      .set('authorization', 'Bearer ' + (await token('super_admin')))
      .send(payload);
    expect(response.status).toBe(201);
    ids.push(response.body.data.id);
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [adminId]);
    const rejected = await request(app)
      .patch('/admin/vehicle-types/' + response.body.data.id)
      .set('authorization', 'Bearer ' + (await token('super_admin')))
      .send({ baseFare: 120, expectedVersion: 1 });
    expect(rejected.status).toBe(403);
  });
  it('database unique code handles concurrent creates; updates use one optimistic winner', async () => {
    const results = await Promise.allSettled([create(), create()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.code).toBe('VEHICLE_TYPE_DUPLICATE');
    const type = (
      results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<VehicleType>
    ).value;
    const updates = await Promise.allSettled([
      admin.updateVehicleType(adminId, type.id, {
        baseFare: 120,
        perKmRate: 18,
        expectedVersion: 1,
      }),
      admin.updateVehicleType(adminId, type.id, {
        baseFare: 130,
        perKmRate: 19,
        expectedVersion: 1,
      }),
    ]);
    expect(updates.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (updates.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code,
    ).toBe('VEHICLE_TYPE_VERSION_CONFLICT');
    expect((await vehicles.getType(type.id))!.version).toBe(2);
  });
  it.each(['passenger', 'logistics', 'service', 'premium'] as const)(
    'dynamic %s uses same exact model and matching',
    async (sector) => {
      const type = await create({ ...payload, sector, active: true });
      await pool.query('UPDATE vehicles SET sector=$2 WHERE id=$1', [vehicleId, sector]);
      // Changing vehicle identity invalidates approval; model the completed re-review.
      if (sector !== 'passenger') {
        const changed = await pool.query(
          'SELECT verification_status, is_active FROM vehicles WHERE id=$1',
          [vehicleId],
        );
        expect(changed.rows[0]).toMatchObject({ verification_status: 'pending', is_active: false });
      }
      await pool.query(
        "UPDATE vehicles SET verification_status='approved',is_active=TRUE WHERE id=$1",
        [vehicleId],
      );
      const ride = await service.createRide(customerId, {
        ...booking,
        sector,
        goods: { weightKg: 100, hasLoadingAssistance: true },
        rentalDetails: { hours: 4, fuelRatePerKm: 999 },
      });
      expect(ride.fareEstimate).toBe(250);
      expect(await rides.offerDispatch(ride.id, profileId, 60000)).toBe(true);
      await service.acceptRide(profileId, ride.id);
      expect((await service.getDriverMap(driverId, ride.id)).fare.bookedAmount).toBe(250);
      await rides.transition(ride.id, 'driver_arriving', profileId);
      await rides.transition(ride.id, 'driver_arrived', profileId);
      await rides.markPinVerified(ride.id);
      await rides.transition(ride.id, 'in_progress', profileId);
      await admin.updateVehicleType(adminId, type.id, { baseFare: 120, expectedVersion: 1 });
      const complete = await service.completeRide(ride.id, profileId);
      expect(complete.finalFare).toBe(250);
      expect(complete.billing).toEqual({ currency: 'INR', finalFare: 250 });
    },
  );
  it('deactivation blocks new rides; stale quote and changed rate reject atomically', async () => {
    const type = await create({ ...payload, active: true });
    const result = await estimator.estimate(booking.pickup, booking.destination, {
      sector: 'passenger',
      vehicleCategory: 'xyz',
      pricingMode: 'vehicle_range',
    });
    if (!('bookingFare' in result) || !result.bookingFare) throw new Error('Expected fixed fare');
    const snapshot = result.bookingFare as FareCalculationResult;
    await admin.updateVehicleType(adminId, type.id, { baseFare: 120, expectedVersion: 1 });
    await expect(
      rides.create(customerId, { ...booking, fareEstimate: 250, bookingFareSnapshot: snapshot }),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_CHANGED' });
    await admin.updateVehicleType(adminId, type.id, { active: false, expectedVersion: 2 });
    await expect(
      rides.create(customerId, { ...booking, fareEstimate: 250, bookingFareSnapshot: snapshot }),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
    await expect(service.createRide(customerId, booking)).rejects.toMatchObject({
      code: 'FARE_CONFIGURATION_MISSING',
    });
    expect(
      (await pool.query('SELECT id FROM rides WHERE customer_id=$1', [customerId])).rowCount,
    ).toBe(0);
  });
  it('reloads configuration after slow routing and rejects deactivation during routing', async () => {
    const type = await create({ ...payload, active: true });
    const slow = new FareEstimateService(
      {
        ...routes,
        calculateRoute: async () => {
          await admin.updateVehicleType(adminId, type.id, {
            baseFare: 120,
            perKmRate: 18,
            expectedVersion: 1,
          });
          return { distanceMeters: 10000, durationSeconds: 1200 };
        },
      },
      new FareCalculatorService(),
      undefined,
      vehicles,
    );
    const first = await new RideService(rides, drivers, undefined, slow).createRide(
      customerId,
      booking,
    );
    expect(first.fareEstimate).toBe(300);
    const disabling = new FareEstimateService(
      {
        ...routes,
        calculateRoute: async () => {
          await admin.updateVehicleType(adminId, type.id, { active: false, expectedVersion: 2 });
          return { distanceMeters: 10000, durationSeconds: 1200 };
        },
      },
      new FareCalculatorService(),
      undefined,
      vehicles,
    );
    await expect(
      new RideService(rides, drivers, undefined, disabling).createRide(customerId, booking),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
    expect(
      (await pool.query('SELECT id FROM rides WHERE customer_id=$1', [customerId])).rowCount,
    ).toBe(1);
  });
  it('configured existing tariffs keep ranges and aliases; another sector keeps its own tariff', async () => {
    const type = await create({
      ...payload,
      name: 'Mini Cab',
      code: 'mini',
      baseFare: 60,
      perKmRate: 10,
      active: true,
    });
    const fare = await estimator.estimate(booking.pickup, booking.destination, {
      sector: 'passenger',
      vehicleCategory: 'mini_cab',
      pricingMode: 'vehicle_range',
    });
    expect(fare).toMatchObject({
      bookable: true,
      pricing: VEHICLE_FARE_PRICING.passenger!.mini,
      bookingFare: { grossAmount: 16000 },
    });
    expect('estimatedFare' in fare && fare.estimatedFare!.minimum.grossAmount).not.toBe(16000);
    await admin.updateVehicleType(adminId, type.id, { active: false, expectedVersion: 1 });
    await expect(
      estimator.estimate(booking.pickup, booking.destination, {
        sector: 'passenger',
        vehicleCategory: 'mini_cab',
        pricingMode: 'vehicle_range',
      }),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
    const premium = await estimator.estimate(booking.pickup, booking.destination, {
      sector: 'premium',
      vehicleCategory: 'mini',
      rentalHours: 1,
      pricingMode: 'vehicle_range',
    });
    expect('grossAmount' in premium).toBe(true);
  });
  it('prototype-like dynamic codes use configured rates without inherited defaults', async () => {
    await create({ ...payload, code: 'constructor', active: true });
    const ride = await service.createRide(customerId, {
      ...booking,
      vehicleCategory: 'constructor',
    });
    expect(ride.fareEstimate).toBe(250);
  });
  it('legacy quote cannot bypass newly created configuration', async () => {
    const input = { ...booking, sector: 'premium' as const, vehicleCategory: 'fortuner' };
    const previous = await estimator.estimate(input.pickup, input.destination, {
      sector: input.sector,
      vehicleCategory: input.vehicleCategory,
      pricingMode: 'vehicle_range',
    });
    if (!('grossAmount' in previous) || previous.grossAmount === undefined)
      throw new Error('Expected existing premium tariff');
    const type = await create({ ...payload, code: 'fortuner', sector: 'premium', active: true });
    await expect(
      rides.create(customerId, {
        ...input,
        fareEstimate: previous.grossAmount / 100,
        bookingFareSnapshot: previous,
      }),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_CHANGED' });
    await admin.updateVehicleType(adminId, type.id, { active: false, expectedVersion: 1 });
    await expect(
      rides.create(customerId, {
        ...input,
        fareEstimate: previous.grossAmount / 100,
        bookingFareSnapshot: previous,
      }),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
    expect(
      (await pool.query('SELECT id FROM rides WHERE customer_id=$1', [customerId])).rowCount,
    ).toBe(0);
  });
  it('catalog creation waits for the booking lock even when no configuration row exists', async () => {
    const client = await pool.connect();
    let pending: Promise<VehicleType> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,648032))', [
        'xyz',
      ]);
      pending = create();
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        // PostgreSQL caches statistics snapshots inside a transaction; refresh
        // before observing the other connection's lock wait.
        await client.query('SELECT pg_stat_clear_snapshot()');
        const locks = await client.query(
          "SELECT 1 FROM pg_stat_activity WHERE query='SELECT pg_advisory_xact_lock(hashtextextended($1,648032))' AND wait_event_type='Lock'",
        );
        if (locks.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      expect((await client.query("SELECT id FROM vehicle_types WHERE code='xyz'")).rowCount).toBe(
        0,
      );
      await client.query('COMMIT');
      expect((await pending).code).toBe('xyz');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      if (pending) await pending;
    }
  });
  it('strict HTTP validation and database constraints reject missing/invalid prices', async () => {
    for (const body of [
      { ...payload, baseFare: -1 },
      { ...payload, perKmRate: 1.001 },
      { name: 'Missing', code: 'missing', sector: 'passenger', active: true },
    ]) {
      const response = await request(app)
        .post('/admin/vehicle-types')
        .set('authorization', 'Bearer ' + (await token()))
        .send(body);
      expect(response.status).toBe(400);
    }
    await expect(
      pool.query(
        "INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise) VALUES('Bad','bad','passenger',NULL,1500)",
      ),
    ).rejects.toMatchObject({ code: '23502' });
    await expect(
      pool.query(
        "INSERT INTO vehicle_types(name,code,sector,base_fare_paise,per_km_rate_paise) VALUES('FTL','ftl','logistics',10000,1500)",
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('unknown/missing/wrong-sector and FTL never acquire fallback fares; ranges preserved', async () => {
    for (const sector of ['passenger', 'logistics', 'service', 'premium'] as const) {
      await expect(service.createRide(customerId, { ...booking, sector })).rejects.toMatchObject({
        code: 'FARE_CONFIGURATION_MISSING',
      });
    }
    await expect(
      admin.createVehicleType(adminId, {
        ...payload,
        code: 'ftl',
        sector: 'logistics',
        active: true,
      }),
    ).rejects.toMatchObject({ code: 'VEHICLE_TYPE_INVALID' });
    await expect(
      admin.createVehicleType(adminId, { ...payload, code: 'sedan', sector: 'logistics' }),
    ).rejects.toMatchObject({ code: 'VEHICLE_TYPE_INVALID' });
    await expect(
      admin.createVehicleType(adminId, { ...payload, code: 'mini_cab' }),
    ).rejects.toMatchObject({ code: 'VEHICLE_TYPE_INVALID' });
    for (const [sector, tariffs] of Object.entries(VEHICLE_FARE_PRICING))
      for (const [code, pricing] of Object.entries(tariffs)) {
        const estimate = await estimator.estimate(booking.pickup, booking.destination, {
          sector: sector as 'passenger' | 'logistics',
          vehicleCategory: code,
          pricingMode: 'vehicle_range',
        });
        expect(estimate).toMatchObject({ bookable: false, pricing });
      }
    const type = await create({ ...payload, active: true });
    expect(type.active).toBe(true);
    await expect(
      service.createRide(customerId, { ...booking, sector: 'logistics' }),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
  });
});
