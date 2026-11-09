import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { ServiceAreaPolicy, serviceArea } from '../../maps/service-area.js';
import { VehicleController } from '../controllers/vehicle.controller.js';
import { VehicleService } from '../services/vehicle.service.js';
import { createVehicleRouter } from '../routes/vehicle.routes.js';
import { RideController } from '../../rides/controllers/ride.controller.js';
import { createRideRouter } from '../../rides/routes/ride.routes.js';
import { AdminService } from '../../admin/services/admin.service.js';
import { AdminController } from '../../admin/controllers/admin.controller.js';
import { PostgresAdminRepository } from '../../admin/repositories/admin.repository.js';
import { createAdminRouter } from '../../admin/routes/admin.routes.js';
import { AdminOperationsRepository } from '../../admin/repositories/operations.repository.js';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresVehicleRepository } from '../repositories/vehicle.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { MatchingService } from '../../rides/services/matching.service.js';
import { RideService } from '../../rides/services/ride.service.js';
import { createVehicleTypeSchema, updateVehicleTypeSchema } from '../schemas/vehicle.schemas.js';
import type { CreateRideInput } from '../../rides/schemas/ride.schemas.js';
import type { VehicleType } from '../types/vehicle.js';
import type { Ride } from '../../rides/types/ride.js';

describe.runIf(process.env.RIDE_DB_TESTS === 'true')(
  'Service fixed fare and PostGIS booking lifecycle',
  () => {
    const vehicles = new PostgresVehicleRepository(pool),
      rides = new PostgresRideRepository(pool),
      drivers = new PostgresDriverRepository(pool);
    const pickup = { latitude: 25.59, longitude: 85.1 };
    const area = { configured: true, required: true, assertSupported: async () => {} };
    const matcher = new MatchingService(drivers, undefined, area);
    const estimator = new FareEstimateService(
      {
        calculateRoute: async () => {
          throw Error('Fixed service quotes must not require routing');
        },
      } as never,
      new FareCalculatorService(),
      undefined,
      vehicles,
    );
    const service = new RideService(
      rides,
      drivers,
      undefined,
      estimator,
      undefined,
      area,
      undefined,
      matcher,
    );
    let adminId: string,
      customerId: string,
      driverId: string,
      profileId: string,
      vehicleId: string,
      type: VehicleType;
    const input = (): CreateRideInput => ({
      pickup,
      destination: { latitude: 25.65, longitude: 85.15 },
      sector: 'service',
      vehicleCategory: type.code,
      clientRequestId: randomUUID(),
    });
    beforeEach(async () => {
      const ids: string[] = [];
      for (const role of ['admin', 'customer', 'driver_fleet_owner']) {
        const id = randomUUID();
        ids.push(id);
        await pool.query(
          "INSERT INTO users(id,first_name,last_name,email,role) VALUES($1,'Service','Fixture',$2,$3)",
          [id, `${id}@example.invalid`, role],
        );
      }
      [adminId, customerId, driverId] = ids as [string, string, string];
      type = await vehicles.createType(
        adminId,
        createVehicleTypeSchema.parse({
          name: 'QA Service',
          code: 'qa_service_' + randomUUID().replaceAll('-', '').slice(0, 12),
          sector: 'service',
          baseFare: null,
          perKmRate: null,
          serviceFixedFare: 123.45,
          active: true,
        }),
      );
      profileId = (
        await pool.query(
          "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status,availability_status,last_location,last_location_at,location_accuracy,online_preference) VALUES($1,$2,'2030-12-31','approved','available',ST_SetSRID(ST_MakePoint(85.13,25.60),4326)::geography,NOW(),8,TRUE) RETURNING id",
          [driverId, randomUUID()],
        )
      ).rows[0].id;
      vehicleId = (
        await pool.query(
          "INSERT INTO vehicles(driver_profile_id,owner_id,make,model,plate_number,sector,category,verification_status,is_active) VALUES($1,$2,'QA','Service',$3,'service',$4,'approved',TRUE) RETURNING id",
          [profileId, driverId, randomUUID().slice(0, 18), type.code],
        )
      ).rows[0].id;
      await pool.query('UPDATE driver_profiles SET active_vehicle_id=$2 WHERE id=$1', [
        profileId,
        vehicleId,
      ]);
    });
    afterEach(async () => {
      await pool.query('DELETE FROM rides WHERE customer_id=$1', [customerId]);
      await pool.query('UPDATE driver_profiles SET active_vehicle_id=NULL WHERE id=$1', [
        profileId,
      ]);
      await pool.query('DELETE FROM vehicles WHERE id=$1', [vehicleId]);
      await pool.query('DELETE FROM driver_profiles WHERE id=$1', [profileId]);
      await pool.query('DELETE FROM vehicle_types WHERE id=$1', [type.id]);
      await pool.query(
        'DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])',
        [[adminId, customerId, driverId]],
      );
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
        [adminId, customerId, driverId],
      ]);
    });
    async function place(distance: number, age = 0) {
      await pool.query(
        'UPDATE driver_profiles SET last_location=ST_Project(ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4::float8,0::float8),last_location_at=NOW()-make_interval(secs=>$5::int) WHERE id=$1',
        [profileId, pickup.longitude, pickup.latitude, distance, age],
      );
    }
    const candidates = (point = pickup) =>
      matcher.findDispatchDrivers(
        {
          id: randomUUID(),
          customerId,
          pickup: point,
          sector: 'service',
          vehicleCategory: type.code,
        } as Ride,
        25000,
      );
    it('retains the approved Bihar boundary for pickups and for nearby driver locations', async () => {
      const boundary = JSON.parse(
        readFileSync(
          new URL('../../../../config/service-area/bihar.geojson', import.meta.url),
          'utf8',
        ),
      );
      const policy = new ServiceAreaPolicy(boundary, true);
      await expect(policy.assertSupported([pickup])).resolves.toBeUndefined();
      await expect(
        policy.assertSupported([{ latitude: 26.91, longitude: 75.79 }]),
      ).rejects.toMatchObject({ code: 'SERVICE_AREA_UNAVAILABLE' });
      const boundaryRead = vi
        .spyOn(serviceArea, 'boundaryGeoJson', 'get')
        .mockReturnValue(JSON.stringify(boundary));
      try {
        expect((await candidates()).map((d) => d.driverProfileId)).toContain(profileId);
        await pool.query(
          'UPDATE driver_profiles SET last_location=ST_SetSRID(ST_MakePoint(75.79,26.91),4326)::geography,last_location_at=NOW() WHERE id=$1',
          [profileId],
        );
        expect(
          await drivers.findNearbyEligible(
            26.91,
            75.79,
            25000,
            10,
            new Date(Date.now() - 30000),
            'service',
            type.code,
          ),
        ).toEqual([]);
      } finally {
        boundaryRead.mockRestore();
      }
    });
    it('serves live fixed-fare availability/catalog with auth, and persists only authorized Admin changes', async () => {
      const app = express();
      app.use(express.json());
      app.use(
        '/vehicles',
        createVehicleRouter(new VehicleController(new VehicleService(vehicles))),
      );
      app.use('/rides', createRideRouter(new RideController(service)));
      app.use(
        '/admin',
        createAdminRouter(
          new AdminController(new AdminService(new PostgresAdminRepository(pool), vehicles)),
        ),
      );
      app.use(errorMiddleware);
      const token = await signAccessToken({ sub: customerId, role: 'customer', type: 'access' });
      expect((await request(app).get('/vehicles/catalog?sector=service')).status).toBe(401);
      const catalog = await request(app)
        .get('/vehicles/catalog?sector=service&limit=100')
        .auth(token, { type: 'bearer' });
      expect(catalog.status, catalog.text).toBe(200);
      expect(catalog.body.data).toContainEqual(
        expect.objectContaining({
          code: type.code,
          serviceFixedFare: 123.45,
          serviceRadiusMeters: 25000,
        }),
      );
      const quote = { pickup, destination: pickup, sector: 'service', vehicleCategory: type.code };
      const available = await request(app)
        .post('/rides/service-availability')
        .auth(token, { type: 'bearer' })
        .send(quote);
      expect(available.status, available.text).toBe(200);
      expect(available.body.data).toMatchObject({
        available: true,
        bookable: true,
        bookingFare: { baseAmount: 12345, grossAmount: 12300, roundingAdjustmentPaise: -45 },
      });
      expect(JSON.stringify(available.body)).not.toContain(profileId);
      await place(25000.01);
      expect(
        (
          await request(app)
            .post('/rides/service-availability')
            .auth(token, { type: 'bearer' })
            .send(quote)
        ).body.data,
      ).toMatchObject({
        available: false,
        bookable: false,
        bookingFare: { baseAmount: 12345, grossAmount: 12300, roundingAdjustmentPaise: -45 },
      });
      const changed = await request(app)
        .patch('/admin/vehicle-types/' + type.id)
        .auth(token, { type: 'bearer' })
        .send({ expectedVersion: type.version, serviceFixedFare: 1 });
      expect(changed.status).toBe(403);
      expect((await vehicles.getType(type.id))?.serviceFixedFare).toBe(123.45);
      expect(
        (
          await request(app)
            .post('/rides')
            .auth(token, { type: 'bearer' })
            .send({ ...quote, clientRequestId: randomUUID() })
        ).status,
      ).toBe(409);
      expect(
        (await request(app).post('/rides').auth(token, { type: 'bearer' }).send(quote)).status,
      ).toBe(400);
      await place(100);
      const ride = await service.createRide(customerId, input());
      const records = await new AdminOperationsRepository(pool).list('rides', {
        page: 1,
        pageSize: 25,
        sector: 'service',
        recordId: ride.id,
      });
      expect(records.items).toContainEqual(
        expect.objectContaining({ id: ride.id, sector: 'service', fare_estimate: 123 }),
      );
    });
    it.each([0, 24999.99, 25000])(
      'includes geography distance %s m at the default radius',
      async (distance) => {
        await place(distance);
        expect((await candidates()).map((d) => d.driverProfileId)).toContain(profileId);
      },
    );
    it('excludes beyond 25 km, missing/stale location, offline, wrong category and unapproved vehicles', async () => {
      await place(25000.01);
      expect(await candidates()).toEqual([]);
      await place(100, 120);
      expect(await candidates()).toEqual([]);
      await place(100);
      await pool.query("UPDATE driver_profiles SET availability_status='unavailable' WHERE id=$1", [
        profileId,
      ]);
      expect(await candidates()).toEqual([]);
      await pool.query(
        "UPDATE driver_profiles SET availability_status='available',last_location=NULL,last_location_at=NULL WHERE id=$1",
        [profileId],
      );
      expect(await candidates()).toEqual([]);
      await place(100);
      await pool.query("UPDATE vehicles SET category='other_service' WHERE id=$1", [vehicleId]);
      expect(await candidates()).toEqual([]);
      await pool.query(
        "UPDATE vehicles SET category=$2,verification_status='pending' WHERE id=$1",
        [vehicleId, type.code],
      );
      expect(await candidates()).toEqual([]);
    });
    it('keeps narrower configured radii and caps larger values at 25 km without changing the fare', async () => {
      await place(25001);
      expect(await candidates()).toEqual([]);
      type = await vehicles.updateType(
        adminId,
        type.id,
        updateVehicleTypeSchema.parse({
          expectedVersion: type.version,
          serviceRadiusMeters: 35000,
        }),
      );
      expect(await candidates()).toEqual([]);
      await place(12000);
      expect((await candidates()).map((d) => d.driverProfileId)).toContain(profileId);
      type = await vehicles.updateType(
        adminId,
        type.id,
        updateVehicleTypeSchema.parse({
          expectedVersion: type.version,
          serviceRadiusMeters: 10000,
        }),
      );
      expect(await candidates()).toEqual([]);
      expect(type.serviceFixedFare).toBe(123.45);
    });
    it('switches cities from valid GPS and blocks even nearby cross-city pickups', async () => {
      const cities = (
        await pool.query(`
          WITH locations AS (
            SELECT ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography AS patna,
                   ST_SetSRID(ST_MakePoint(85.4,26.12),4326)::geography AS muzaffarpur
          ), points AS (
            SELECT ST_Project(patna,24000,ST_Azimuth(patna,muzaffarpur)) AS a,
                   ST_Project(muzaffarpur,24000,ST_Azimuth(muzaffarpur,patna)) AS b
            FROM locations
          )
          SELECT ST_Y(a::geometry) AS "patnaLat",ST_X(a::geometry) AS "patnaLon",
                 ST_Y(b::geometry) AS "muzzLat",ST_X(b::geometry) AS "muzzLon",
                 ST_Distance(a,b) AS distance FROM points`)
      ).rows[0];
      const patna = { latitude: cities.patnaLat, longitude: cities.patnaLon };
      const muzaffarpur = { latitude: cities.muzzLat, longitude: cities.muzzLon };
      expect(cities.distance).toBeLessThan(25000);
      const locate = (point: typeof pickup, accuracy: number | null) =>
        pool.query(
          'UPDATE driver_profiles SET last_location=ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,last_location_at=NOW(),location_accuracy=$4 WHERE id=$1',
          [profileId, point.longitude, point.latitude, accuracy],
        );
      await locate(patna, 8);
      expect((await candidates(patna)).map((driver) => driver.driverProfileId)).toContain(
        profileId,
      );
      expect(await candidates(muzaffarpur)).toEqual([]);
      const ride = await service.createRide(customerId, { ...input(), pickup: patna });
      expect(await rides.offerDispatch(ride.id, profileId, 30000)).toBe(true);
      await locate(muzaffarpur, 8);
      expect(await rides.accept(ride.id, profileId)).toBeNull();
      expect(await rides.pendingDispatch(ride.id)).toBeNull();
      expect(await candidates(patna)).toEqual([]);
      expect((await candidates(muzaffarpur)).map((driver) => driver.driverProfileId)).toContain(
        profileId,
      );
      await locate(muzaffarpur, null);
      expect(await candidates(muzaffarpur)).toEqual([]);
      await locate(muzaffarpur, 201);
      expect(await candidates(muzaffarpur)).toEqual([]);
    });
    it('fails disabled and unconfigured services closed and rejects unauthorized changes', async () => {
      await expect(
        vehicles.updateType(customerId, type.id, {
          expectedVersion: type.version,
          serviceFixedFare: 0,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        vehicles.updateType(adminId, type.id, {
          expectedVersion: type.version,
          perKmRate: 1,
          baseFare: 1,
        }),
      ).rejects.toBeDefined();
      type = await vehicles.updateType(adminId, type.id, {
        expectedVersion: type.version,
        active: false,
      });
      expect(await candidates()).toEqual([]);
      await expect(service.createRide(customerId, input())).rejects.toBeDefined();
      type = await vehicles.updateType(adminId, type.id, {
        expectedVersion: type.version,
        serviceFixedFare: null,
      });
      expect(await candidates()).toEqual([]);
      await expect(
        vehicles.updateType(adminId, type.id, { expectedVersion: type.version, active: true }),
      ).rejects.toBeDefined();
    });
    it('locks the fixed fare/version, rejects client fare overrides, and records Admin changes', async () => {
      await expect(
        service.createRide(customerId, { ...input(), fareEstimate: 1 }),
      ).rejects.toMatchObject({ code: 'FARE_QUOTE_MISMATCH' });
      const ride = await service.createRide(customerId, input());
      type = await vehicles.updateType(adminId, type.id, {
        expectedVersion: type.version,
        serviceFixedFare: 456.78,
      });
      const row = (
        await pool.query(
          "SELECT fare_estimate,route_metadata->'bookingFareSnapshot' AS fare FROM rides WHERE id=$1",
          [ride.id],
        )
      ).rows[0];
      expect(Number(row.fare_estimate)).toBe(123);
      expect(row.fare).toMatchObject({
        baseAmount: 12345,
        grossAmount: 12300,
        roundingAdjustmentPaise: -45,
        distanceAmount: 0,
        timeAmount: 0,
        vehicleConfiguration: { version: 1, pricingModel: 'service_fixed' },
      });
      expect(
        (
          await pool.query(
            "SELECT metadata FROM user_history WHERE user_id=$1 AND entity_id=$2 AND event_type='vehicle_type_updated'",
            [adminId, type.id],
          )
        ).rows[0].metadata.new.serviceFixedFare,
      ).toBe(456.78);
    });
    it('returns one booking for concurrent duplicate requests and retry after assignment or fare changes', async () => {
      const intent = input();
      const [a, b] = await Promise.all([
        service.createRide(customerId, intent),
        service.createRide(customerId, intent),
      ]);
      expect(a.id).toBe(b.id);
      expect(await rides.offerDispatch(a.id, profileId, 30000)).toBe(true);
      expect(await rides.accept(a.id, profileId)).not.toBeNull();
      type = await vehicles.updateType(adminId, type.id, {
        expectedVersion: type.version,
        serviceFixedFare: 456.78,
      });
      expect((await service.createRide(customerId, intent)).id).toBe(a.id);
      await expect(
        service.createRide(customerId, { ...intent, destination: pickup }),
      ).rejects.toMatchObject({ code: 'BOOKING_REQUEST_CONFLICT' });
      expect(
        Number(
          (await pool.query('SELECT count(*) FROM rides WHERE customer_id=$1', [customerId]))
            .rows[0].count,
        ),
      ).toBe(1);
    });
    it('rechecks radius and enabled status at offer and atomic acceptance', async () => {
      const ride = await service.createRide(customerId, input());
      await place(25000.01);
      expect(await rides.offerDispatch(ride.id, profileId, 30000)).toBe(false);
      await place(24999);
      expect(await rides.offerDispatch(ride.id, profileId, 30000)).toBe(true);
      await place(25000.01);
      expect(await rides.accept(ride.id, profileId)).toBeNull();
      await place(100);
      type = await vehicles.updateType(adminId, type.id, {
        expectedVersion: type.version,
        active: false,
      });
      expect(await rides.accept(ride.id, profileId)).toBeNull();
    });
    it('accepts once and completes the shared arrival/PIN/lifecycle with the locked fare', async () => {
      const ride = await service.createRide(customerId, input());
      expect(await rides.offerDispatch(ride.id, profileId, 30000)).toBe(true);
      const accepted = await Promise.allSettled([
        service.acceptRide(profileId, ride.id),
        service.acceptRide(profileId, ride.id),
      ]);
      expect(accepted.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      await service.transitionRide(ride.id, 'driver_arriving', profileId);
      const arrival = await service.transitionRide(ride.id, 'driver_arrived', profileId);
      expect(arrival.status).toBe('driver_arrived');
      expect(ride.pin).toBeTruthy();
      expect(
        (await service.transitionRide(ride.id, 'in_progress', profileId, ride.pin!)).status,
      ).toBe('in_progress');
      expect((await service.completeRide(ride.id, profileId)).status).toBe('completed');
      const row = (
        await pool.query('SELECT final_fare,assigned_driver_id,status FROM rides WHERE id=$1', [
          ride.id,
        ])
      ).rows[0];
      expect(Number(row.final_fare)).toBe(123);
      expect(row.assigned_driver_id).toBe(profileId);
      expect(row.status).toBe('completed');
    });
  },
);
