import { rideEvents } from '../events/ride.events.js';
import { createServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { CommonMapService } from '../../maps/map.service.js';
import { RouteRecalculationService } from '../services/route-recalculation.service.js';
import { DriverService } from '../services/driver.service.js';
import { RideController } from '../controllers/ride.controller.js';
import { DriverController } from '../controllers/driver.controller.js';
import { createRideRouter } from '../routes/ride.routes.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import type { DriverDocumentStorageService } from '../services/driver-document-storage.service.js';
import { randomUUID } from 'node:crypto';
import { RideDispatchService } from '../services/ride-dispatch.service.js';
import type { MatchingService } from '../services/matching.service.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { RideService } from '../services/ride.service.js';

const databaseEnabled = process.env.RIDE_DB_TESTS === 'true';
const describeDatabase = databaseEnabled ? describe : describe.skip;
const repository = new PostgresRideRepository(pool);
const driverRepository = new PostgresDriverRepository(pool);
const service = new RideService(repository, driverRepository);

interface Fixture {
  rideIds: string[];
  customerId: string;
  driverUserId: string;
  driverProfileId: string;
  vehicleId: string;
}

async function createFixture(rideCount = 1): Promise<Fixture> {
  const suffix = randomUUID();
  const customer = await pool.query<{ id: string }>(
    `INSERT INTO users (first_name, last_name, phone, role)
     VALUES ('Ride', 'Customer', $1, 'customer') RETURNING id`,
    [`+91${suffix.replaceAll('-', '').slice(0, 10)}`],
  );
  const driver = await pool.query<{ id: string }>(
    `INSERT INTO users (first_name, last_name, phone, role)
     VALUES ('Ride', 'Driver', $1, 'driver') RETURNING id`,
    [`+92${suffix.replaceAll('-', '').slice(0, 10)}`],
  );
  const profile = await pool.query<{ id: string }>(
    `INSERT INTO driver_profiles
       (user_id, license_number, license_expiry, verification_status)
     VALUES ($1, $2, CURRENT_DATE + 365, 'approved') RETURNING id`,
    [driver.rows[0]!.id, `LIC-${suffix}`],
  );
  const vehicle = await pool.query<{ id: string }>(
    `INSERT INTO vehicles (driver_profile_id, make, model, plate_number, verification_status, is_active)
     VALUES ($1, 'Test', 'Vehicle', $2, 'approved', TRUE) RETURNING id`,
    [profile.rows[0]!.id, `P-${suffix.replaceAll('-', '').slice(0, 15)}`],
  );
  await pool.query(
    `UPDATE driver_profiles
     SET availability_status = 'available',
         last_location = ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography,
         last_location_at = $2
     WHERE id = $1`,
    [profile.rows[0]!.id, new Date(Date.now() - 1000)],
  );
  const rides: string[] = [];
  for (let index = 0; index < rideCount; index += 1) {
    const ride = await pool.query<{ id: string }>(
      `INSERT INTO rides
         (customer_id, vehicle_category, pin, pickup_location, destination_location)
       VALUES ($1, 'sedan', '7391', ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography,
          ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography)
       RETURNING id`,
      [customer.rows[0]!.id],
    );
    rides.push(ride.rows[0]!.id);
    await pool.query(`UPDATE rides SET status = 'searching' WHERE id = $1`, [rides[index]]);
    if (index === 0)
      expect(await repository.offerDispatch(rides[index]!, profile.rows[0]!.id, 60000)).toBe(true);
  }
  return {
    rideIds: rides,
    customerId: customer.rows[0]!.id,
    driverUserId: driver.rows[0]!.id,
    driverProfileId: profile.rows[0]!.id,
    vehicleId: vehicle.rows[0]!.id,
  };
}

async function cleanFixture(fixture: Fixture): Promise<void> {
  await pool.query('DELETE FROM rides WHERE id = ANY($1::uuid[])', [fixture.rideIds]);
  await pool.query('DELETE FROM vehicles WHERE id = $1', [fixture.vehicleId]);
  await pool.query('DELETE FROM driver_profiles WHERE id = $1', [fixture.driverProfileId]);
  await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [
    fixture.customerId,
    fixture.driverUserId,
  ]);
}

describeDatabase('ride PostgreSQL integration', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    if (fixture) await cleanFixture(fixture);
  });

  function mapService() {
    const calls: { origin: unknown; target: unknown }[] = [];
    const provider = {
      providerName: 'fixture',
      calculateRoute: async (origin: unknown, target: unknown) => {
        calls.push({ origin, target });
        return { distanceMeters: 8500, durationSeconds: 600 };
      },
      calculateMatrix: async () => [],
      geocode: async () => null,
      places: async () => [],
    };
    const maps = new CommonMapService(provider, undefined, undefined, Date.now, () => {});
    return {
      calls,
      maps,
      service: new RideService(
        repository,
        driverRepository,
        undefined,
        undefined,
        undefined,
        undefined,
        maps,
      ),
    };
  }
  async function prepareMap(sector = 'passenger', amount = 106, distance = 8500) {
    const category =
      sector === 'logistics' ? 'mini_truck' : sector === 'service' ? 'ambulance' : 'sedan';
    await pool.query(
      `UPDATE rides SET sector=$2,fare_estimate=$3,vehicle_category=$5,route_metadata=COALESCE(route_metadata,'{}'::jsonb)||jsonb_build_object('bookingDistanceMeters',$4::numeric) WHERE id=$1`,
      [fixture.rideIds[0], sector, amount, distance, category],
    );
    await pool.query('UPDATE vehicles SET sector=$2,category=$3 WHERE id=$1', [
      fixture.vehicleId,
      sector,
      category,
    ]);
    // Changing vehicle identity invalidates approval; model the completed re-review.
    if (sector !== 'passenger') {
      const changed = await pool.query(
        'SELECT verification_status, is_active FROM vehicles WHERE id=$1',
        [fixture.vehicleId],
      );
      expect(changed.rows[0]).toMatchObject({ verification_status: 'pending', is_active: false });
    }
    await pool.query(
      "UPDATE vehicles SET verification_status='approved',is_active=TRUE WHERE id=$1",
      [fixture.vehicleId],
    );
    await pool.query('UPDATE driver_profiles SET last_location_at=$2 WHERE id=$1', [
      fixture.driverProfileId,
      new Date(Date.now() - 1000),
    ]);
    await service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!);
  }
  it.each([
    ['passenger', 106, 8500],
    ['logistics', 1500, 42000],
    ['service', 200, 9000],
    ['premium', 500, 10000],
  ])(
    'propagates authoritative %s ride fare and booking distance consistently',
    async (sector, amount, distance) => {
      await prepareMap(String(sector), Number(amount), Number(distance));
      const m = mapService(),
        id = fixture.rideIds[0]!;
      const user = await m.service.getUserMap(fixture.customerId, id),
        driver = await m.service.getDriverMap(fixture.driverUserId, id);
      expect(user.fare).toEqual(driver.fare);
      expect(user.fare).toMatchObject({
        amount,
        bookedAmount: amount,
        currency: 'INR',
        authority: 'booked',
      });
      expect(user.totalDistance).toEqual({ meters: distance, source: 'booking' });
      expect(driver.totalDistance).toEqual(user.totalDistance);
      expect(user.pickup).toEqual(driver.pickup);
      expect(user.drop).toEqual(driver.drop);
      expect(driver.rideType).toBe(sector);
      expect(user.driverLocation).not.toBeNull();
      expect(user.routeStatus).toBe('not_requested');
      expect(m.calls).toHaveLength(0);

      expect(Object.keys(driver)).not.toContain('pin');
      expect(Object.keys(driver)).not.toContain('customerId');
    },
  );
  it('enforces actual participant map API authorization and strict queries', async () => {
    await prepareMap();
    const m = mapService();
    const app = express();
    app.use(express.json());
    const controller = new DriverController(
      new DriverService(driverRepository, undefined, repository),
      m.service,
      {} as DriverDocumentStorageService,
    );
    app.use('/rides', createRideRouter(new RideController(m.service), controller));
    app.use(errorMiddleware);
    const userToken = await signAccessToken({
        sub: fixture.customerId,
        role: 'customer',
        type: 'access',
      }),
      driverToken = await signAccessToken({
        sub: fixture.driverUserId,
        role: 'driver',
        type: 'access',
      });
    const id = fixture.rideIds[0]!;
    expect((await request(app).get('/rides/' + id + '/map')).status).toBe(401);
    expect(
      (
        await request(app)
          .get('/rides/' + id + '/map')
          .auth(userToken, { type: 'bearer' })
      ).body.data.fare.amount,
    ).toBe(106);
    expect(
      (
        await request(app)
          .get('/rides/driver/rides/' + id + '/map')
          .auth(driverToken, { type: 'bearer' })
      ).body.data.totalDistance.meters,
    ).toBe(8500);
    expect(
      (
        await request(app)
          .get('/rides/' + id + '/map')
          .auth(driverToken, { type: 'bearer' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get('/rides/driver/rides/' + id + '/map')
          .auth(userToken, { type: 'bearer' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/rides/' + id + '/map?includeRoute=garbage')
          .auth(userToken, { type: 'bearer' })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get('/rides/driver/current-trip').auth(driverToken, { type: 'bearer' }))
        .body.data.rideInformation.fare.amount,
    ).toBe(106);
  });
  it('rejects unrelated users/drivers, future/stale/older user GPS and terminal updates', async () => {
    await prepareMap();
    const m = mapService(),
      id = fixture.rideIds[0]!,
      now = Date.now();
    await expect(m.service.getUserMap(randomUUID(), id)).rejects.toMatchObject({
      code: 'RIDE_NOT_FOUND',
    });
    await expect(m.service.getDriverMap(randomUUID(), id)).rejects.toMatchObject({
      code: 'RIDE_NOT_FOUND',
    });
    await expect(
      m.service.updateUserLocation(fixture.customerId, id, {
        latitude: 12.97,
        longitude: 77.59,
        timestamp: new Date(now + 5000),
      }),
    ).rejects.toMatchObject({ code: 'RIDE_LOCATION_TIMESTAMP_INVALID' });
    await expect(
      m.service.updateUserLocation(fixture.customerId, id, {
        latitude: 12.97,
        longitude: 77.59,
        timestamp: new Date(now - 60000),
      }),
    ).rejects.toMatchObject({ code: 'RIDE_LOCATION_TIMESTAMP_INVALID' });
    const value = await m.service.updateUserLocation(fixture.customerId, id, {
      latitude: 12.97,
      longitude: 77.59,
      timestamp: new Date(now - 1000),
    });
    expect((await m.service.getDriverMap(fixture.driverUserId, id)).userLocation).toEqual(value);
    await expect(
      m.service.updateUserLocation(fixture.customerId, id, {
        latitude: 12.96,
        longitude: 77.58,
        timestamp: new Date(now - 2000),
      }),
    ).rejects.toMatchObject({ code: 'RIDE_LOCATION_CONFLICT' });
    await service.cancelRide(fixture.customerId, id, { reason: 'fixture' });
    const inactive = await m.service.getUserMap(fixture.customerId, id, true);
    expect(inactive.driverLocation).toBeNull();
    expect(inactive.userLocation).toBeNull();
    expect(inactive.route).toBeNull();
    expect(m.calls).toHaveLength(0);
    await expect(
      m.service.updateUserLocation(fixture.customerId, id, {
        latitude: 12.97,
        longitude: 77.59,
        timestamp: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'RIDE_LOCATION_CONFLICT' });
  });
  it('uses driver-to-pickup before pickup and pickup-to-drop in progress without altering fare', async () => {
    await prepareMap();
    const m = mapService(),
      id = fixture.rideIds[0]!;
    const pickup = await m.service.getDriverMap(fixture.driverUserId, id, true);
    expect(pickup.segment).toBe('pickup');
    expect(pickup.pickupEta).toEqual({ seconds: 600, source: 'provider_route' });
    expect(m.calls[0]!.target).toEqual(
      pickup.pickup.address
        ? pickup.pickup
        : { latitude: pickup.pickup.latitude, longitude: pickup.pickup.longitude },
    );
    await service.transitionRide(id, 'driver_arriving', fixture.driverProfileId);
    await service.transitionRide(id, 'driver_arrived', fixture.driverProfileId);
    await service.verifyRidePin(id, fixture.driverProfileId, '7391');
    await service.transitionRide(id, 'in_progress', fixture.driverProfileId);
    const active = await m.service.getUserMap(fixture.customerId, id, true);
    expect(active.segment).toBe('destination');
    expect(active.pickupEta).toBeNull();
    expect(m.calls[1]).toEqual({
      origin: { latitude: active.pickup.latitude, longitude: active.pickup.longitude },
      target: { latitude: active.drop.latitude, longitude: active.drop.longitude },
    });
    expect(active.fare.amount).toBe(106);
  });
  it('propagates ordered opt-in user locations over real authenticated sockets only to the ride participants', async () => {
    await prepareMap();
    const m = mapService(),
      id = fixture.rideIds[0]!,
      http = createServer();
    const io = createSocketServer(http, {
      driverService: new DriverService(driverRepository, undefined, repository),
      rideRepository: repository,
      rideService: m.service,
      routeRecalculationService: new RouteRecalculationService(m.maps),
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('address');
    const clients: Socket[] = [];
    const open = async (userId: string, role: string) => {
      const token = await signAccessToken({ sub: userId, role, type: 'access' });
      const c = connect('http://127.0.0.1:' + address.port, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      clients.push(c);
      await new Promise<void>((r, j) => {
        c.once('connect', r);
        c.once('connect_error', j);
      });
      return c;
    };
    const ack = (c: Socket, event: string, payload: unknown) =>
      new Promise<any>((r) => c.emit(event, payload, r));
    try {
      const user = await open(fixture.customerId, 'customer'),
        driver = await open(fixture.driverUserId, 'driver'),
        outsider = await open(randomUUID(), 'customer');
      expect(await ack(user, 'ride:join', id)).toMatchObject({ success: true });
      expect(await ack(driver, 'ride:join', id)).toMatchObject({ success: true });
      expect(await ack(outsider, 'ride:join', id)).toMatchObject({ success: false });
      const driverLocations: unknown[] = [];
      driver.on('ride:driver_location_updated', (e) => driverLocations.push(e));
      const locations: unknown[] = [];
      let leaked = 0;
      driver.on('ride:user_location_updated', (e) => locations.push(e));
      outsider.on('ride:user_location_updated', () => leaked++);
      const now = Date.now();
      for (let n = 0; n < 4; n++)
        await m.service.updateUserLocation(fixture.customerId, id, {
          latitude: 12.97 + n / 100000,
          longitude: 77.59,
          timestamp: new Date(now - 15000 + n * 5000),
        });
      await new Promise((r) => setTimeout(r, 100));
      expect(locations.length).toBeGreaterThan(0);
      expect(leaked).toBe(0);
      expect(m.calls).toHaveLength(0);
      rideEvents.emit('driver:location_updated', {
        profileId: fixture.driverProfileId,
        userId: fixture.driverUserId,
        location: { latitude: 12.97, longitude: 77.59, timestamp: new Date(Date.now() - 60000) },
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(driverLocations).toHaveLength(0);
      expect(m.calls).toHaveLength(0);
      expect(
        await ack(driver, 'ride:user_location', {
          rideId: id,
          latitude: 12.97,
          longitude: 77.59,
          timestamp: new Date(),
        }),
      ).toMatchObject({ success: false });
      expect(
        await ack(user, 'ride:user_location', {
          rideId: id,
          latitude: 12.97,
          longitude: 77.59,
          timestamp: new Date(),
        }),
      ).toMatchObject({ success: true });
      await service.cancelRide(fixture.customerId, id, { reason: 'test' });
      const before = locations.length;
      await expect(
        m.service.updateUserLocation(fixture.customerId, id, {
          latitude: 12.97,
          longitude: 77.59,
          timestamp: new Date(),
        }),
      ).rejects.toMatchObject({ code: 'RIDE_LOCATION_CONFLICT' });
      await new Promise((r) => setTimeout(r, 50));
      expect(locations.length).toBe(before);
      expect(leaked).toBe(0);
    } finally {
      clients.forEach((c) => c.disconnect());
      await new Promise<void>((r) => io.close(() => r()));
    }
  });

  it('navigation CAS cannot overwrite newer customer GPS or canonical booking distance', async () => {
    await prepareMap();
    const id = fixture.rideIds[0]!,
      m = mapService();
    const old = await repository.getRouteMetadata(id);
    const value = await m.service.updateUserLocation(fixture.customerId, id, {
      latitude: 12.97,
      longitude: 77.59,
      timestamp: new Date(Date.now() - 1000),
    });
    expect(
      await repository.updateRouteMetadata(id, {
        ...old!,
        lastCalculatedAt: null,
        lastOrigin: null,
        route: null,
        routeVersion: 1,
      }),
    ).toBe(true);
    const snapshot = await repository.getRideMapSnapshot(id, fixture.customerId, 'user');
    expect(snapshot!.userLocation).toEqual(value);
    expect(snapshot!.ride.bookingDistanceMeters).toBe(8500);
  });
  it('cancellation during provider work prevents route and location exposure', async () => {
    await prepareMap();
    const id = fixture.rideIds[0]!;
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (finish = r));
    const maps = new CommonMapService(
      {
        providerName: 'fixture',
        calculateRoute: async () => {
          entered();
          await gate;
          return { distanceMeters: 800, durationSeconds: 60 };
        },
        calculateMatrix: async () => [],
        geocode: async () => null,
        places: async () => [],
      },
      undefined,
      undefined,
      Date.now,
      () => {},
    );
    const serviceMap = new RideService(
      repository,
      driverRepository,
      undefined,
      undefined,
      undefined,
      undefined,
      maps,
    );
    const pending = serviceMap.getUserMap(fixture.customerId, id, true);
    await started;
    await service.cancelRide(fixture.customerId, id, { reason: 'race' });
    finish();
    const result = await pending;
    expect(result.rideStatus).toBe('cancelled');
    expect(result.routeStatus).toBe('inactive');
    expect(result.route).toBeNull();
    expect(result.driverLocation).toBeNull();
  });
  it('rejects malformed request-local route and hides stale driver GPS without inventing ETA', async () => {
    await prepareMap();
    const id = fixture.rideIds[0]!;
    const maps = new CommonMapService(
      {
        providerName: 'fixture',
        calculateRoute: async () => ({ distanceMeters: -1, durationSeconds: 60 }),
        calculateMatrix: async () => [],
        geocode: async () => null,
        places: async () => [],
      },
      undefined,
      undefined,
      Date.now,
      () => {},
    );
    const serviceMap = new RideService(
      repository,
      driverRepository,
      undefined,
      undefined,
      undefined,
      undefined,
      maps,
    );
    await expect(serviceMap.getDriverMap(fixture.driverUserId, id, true)).rejects.toMatchObject({
      statusCode: 503,
    });
    await pool.query('UPDATE driver_profiles SET last_location_at=$2 WHERE id=$1', [
      fixture.driverProfileId,
      new Date(Date.now() - 60000),
    ]);
    const stale = await serviceMap.getUserMap(fixture.customerId, id);
    expect(stale.driverLocationFresh).toBe(false);
    expect(stale.driverLocation).toBeNull();
    expect(stale.pickupEta).toBeNull();
  });
  it('completed map uses final fare and suppresses all live data', async () => {
    await prepareMap();
    const id = fixture.rideIds[0]!;
    await service.transitionRide(id, 'driver_arriving', fixture.driverProfileId);
    await service.transitionRide(id, 'driver_arrived', fixture.driverProfileId);
    await service.verifyRidePin(id, fixture.driverProfileId, '7391');
    await service.transitionRide(id, 'in_progress', fixture.driverProfileId);
    await service.completeRide(id, fixture.driverProfileId);
    const result = await mapService().service.getDriverMap(fixture.driverUserId, id, true);
    expect(result.fare.authority).toBe('final');
    expect(result.fare.amount).toBe(result.fare.finalAmount);
    expect(result.fare.bookedAmount).toBe(106);
    expect(result.routeStatus).toBe('inactive');
    expect(result.userLocation).toBeNull();
    expect(result.driverLocation).toBeNull();
  });
  it('bounds pending customer GPS while slow reads are in flight and releases capacity', async () => {
    await prepareMap();
    const id = fixture.rideIds[0]!;
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    class SlowRepository extends PostgresRideRepository {
      override async getRideMapSnapshot(rideId: string, userId: string, view: 'user' | 'driver') {
        await gate;
        return super.getRideMapSnapshot(rideId, userId, view);
      }
    }
    const bounded = new RideService(new SlowRepository(pool));
    const now = Date.now();
    const jobs = [0, 1, 2].map((n) =>
      bounded.updateUserLocation(fixture.customerId, id, {
        latitude: 12.97,
        longitude: 77.59,
        timestamp: new Date(now - 3000 + n * 1000),
      }),
    );
    await expect(
      bounded.updateUserLocation(fixture.customerId, id, {
        latitude: 12.97,
        longitude: 77.59,
        timestamp: new Date(now),
      }),
    ).rejects.toMatchObject({ code: 'RIDE_LOCATION_CAPACITY', statusCode: 429 });
    finish();
    await Promise.allSettled(jobs);
    expect(
      await bounded.updateUserLocation(fixture.customerId, id, {
        latitude: 12.97,
        longitude: 77.59,
        timestamp: new Date(),
      }),
    ).toMatchObject({ latitude: 12.97 });
  });
  it('a newer navigation version during route lookup suppresses the old response', async () => {
    await prepareMap();
    const id = fixture.rideIds[0]!;
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (finish = r));
    const maps = new CommonMapService(
      {
        providerName: 'fixture',
        calculateRoute: async () => {
          entered();
          await gate;
          return { distanceMeters: 800, durationSeconds: 60 };
        },
        calculateMatrix: async () => [],
        geocode: async () => null,
        places: async () => [],
      },
      undefined,
      undefined,
      Date.now,
      () => {},
    );
    const pending = new RideService(
      repository,
      driverRepository,
      undefined,
      undefined,
      undefined,
      undefined,
      maps,
    ).getDriverMap(fixture.driverUserId, id, true);
    await started;
    await pool.query(
      `UPDATE rides SET route_metadata=route_metadata||'{"routeVersion":5}'::jsonb WHERE id=$1`,
      [id],
    );
    finish();
    const result = await pending;
    expect(result.route).toBeNull();
    expect(result.eta).toBeNull();
    expect(result.routeStatus).toBe('unavailable');
  });
  it('allows exactly one winner in 100 concurrent acceptance attempts', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!),
      ),
    );
    const successful = results.filter((result) => result.status === 'fulfilled');
    const final = await pool.query<{ status: string; assigned_driver_id: string | null }>(
      `SELECT status, assigned_driver_id FROM rides WHERE id = $1`,
      [fixture.rideIds[0]],
    );
    expect(successful).toHaveLength(1);
    expect(final.rows[0]).toMatchObject({
      status: 'driver_assigned',
      assigned_driver_id: fixture.driverProfileId,
    });
    const driver = await pool.query<{ availability_status: string }>(
      `SELECT availability_status FROM driver_profiles WHERE id = $1`,
      [fixture.driverProfileId],
    );
    expect(driver.rows[0]!.availability_status).toBe('busy');
  });

  it('allows exactly one of 100 distinct drivers across two service instances to accept', async () => {
    const competitors: Fixture[] = [];
    try {
      for (let i = 0; i < 99; i++) competitors.push(await createFixture());
      const profiles = [fixture.driverProfileId, ...competitors.map((f) => f.driverProfileId)];
      await pool.query(
        'UPDATE rides SET dispatch_driver_id=NULL,dispatch_expires_at=NULL WHERE id=ANY($1::uuid[])',
        [competitors.flatMap((f) => f.rideIds)],
      );
      await pool.query('DELETE FROM ride_dispatch_attempts WHERE ride_id=ANY($1::uuid[])', [
        competitors.flatMap((f) => f.rideIds),
      ]);
      // Adversarial overlapping valid offers: stronger than sequential production dispatch.
      await pool.query(
        `INSERT INTO ride_dispatch_attempts (ride_id, attempt, driver_profile_id, status, expires_at)
        SELECT $1, ordinality::int + 1, profile, 'offered', NOW()+INTERVAL '1 minute'
        FROM unnest($2::uuid[]) WITH ORDINALITY AS candidates(profile, ordinality)`,
        [fixture.rideIds[0], profiles.slice(1)],
      );
      const second = new RideService(
        new PostgresRideRepository(pool),
        new PostgresDriverRepository(pool),
      );
      const outcomes = await Promise.allSettled(
        profiles.map((profile, index) =>
          (index % 2 ? second : service).acceptRide(profile, fixture.rideIds[0]!),
        ),
      );
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const assigned = await repository.findById(fixture.rideIds[0]!);
      expect(assigned?.status).toBe('driver_assigned');
      expect(profiles).toContain(assigned?.assignedDriverId);
      const counts = await pool.query(
        `SELECT
        (SELECT count(*)::int FROM ride_dispatch_attempts WHERE ride_id=$1 AND status='accepted') AS accepted,
        (SELECT count(*)::int FROM rides WHERE assigned_driver_id=ANY($2::uuid[])
          AND status IN ('driver_assigned','driver_arriving','driver_arrived','in_progress')) AS active,
        (SELECT count(*)::int FROM driver_profiles WHERE id=ANY($2::uuid[]) AND availability_status='busy') AS busy`,
        [fixture.rideIds[0], profiles],
      );
      expect(counts.rows[0]).toEqual({ accepted: 1, active: 1, busy: 1 });
      await expect(
        second.acceptRide(assigned!.assignedDriverId!, fixture.rideIds[0]!),
      ).rejects.toMatchObject({ code: 'RIDE_ACCEPTANCE_CONFLICT' });
      const loser = profiles.find((id) => id !== assigned!.assignedDriverId)!;
      await expect(service.acceptRide(loser, fixture.rideIds[0]!)).rejects.toMatchObject({
        code: 'RIDE_ACCEPTANCE_CONFLICT',
      });
    } finally {
      await pool.query('DELETE FROM rides WHERE id=$1', [fixture.rideIds[0]]);
      for (const competitor of competitors) await cleanFixture(competitor);
    }
  }, 60000);

  it('coordinates two real-database dispatch workers with different driver candidates', async () => {
    const otherFixture = await createFixture();
    const workers: RideDispatchService[] = [];
    try {
      await pool.query('DELETE FROM ride_dispatch_attempts WHERE ride_id=ANY($1::uuid[])', [
        [fixture.rideIds[0], otherFixture.rideIds[0]],
      ]);
      await pool.query(
        'UPDATE rides SET dispatch_driver_id=NULL,dispatch_expires_at=NULL,dispatch_attempt=0 WHERE id=ANY($1::uuid[])',
        [[fixture.rideIds[0], otherFixture.rideIds[0]]],
      );
      let notified = 0;
      const otherRepository = new PostgresRideRepository(pool);
      const otherService = new RideService(otherRepository, new PostgresDriverRepository(pool));
      for (const [index, profile] of [
        fixture.driverProfileId,
        otherFixture.driverProfileId,
      ].entries()) {
        const matching = {
          findRankedDrivers: async () => [{ driverProfileId: profile }],
        } as unknown as MatchingService;
        workers.push(
          new RideDispatchService(
            index ? otherRepository : repository,
            matching,
            async () => {
              notified++;
              await (index ? otherService : service).acceptRide(profile, fixture.rideIds[0]!);
            },
            2000,
          ),
        );
      }
      const ride = (await repository.findById(fixture.rideIds[0]!))!;
      await Promise.all(workers.map((worker) => worker.dispatch(ride)));
      expect(notified).toBe(1);
      const offers = await pool.query(
        'SELECT status FROM ride_dispatch_attempts WHERE ride_id=$1',
        [ride.id],
      );
      expect(offers.rows).toEqual([{ status: 'accepted' }]);
      expect((await repository.findById(ride.id))?.status).toBe('driver_assigned');
    } finally {
      workers.forEach((worker) => worker.dispose());
      // The winning assigned driver can belong to the second fixture.
      await pool.query('DELETE FROM rides WHERE id=$1', [fixture.rideIds[0]]);
      await cleanFixture(otherFixture);
    }
  });

  it('rolls back partial assignment when offer consumption produces no accepted result', async () => {
    class PartialRepository extends PostgresRideRepository {
      override async accept(
        id: string,
        driver: string,
        client = pool as Parameters<PostgresRideRepository['accept']>[2],
      ) {
        await client!.query(
          "UPDATE rides SET assigned_driver_id=$2,assigned_vehicle_id=$3,status='driver_assigned' WHERE id=$1",
          [id, driver, fixture.vehicleId],
        );
        return null;
      }
    }
    await expect(
      new RideService(new PartialRepository(pool), driverRepository).acceptRide(
        fixture.driverProfileId,
        fixture.rideIds[0]!,
      ),
    ).rejects.toMatchObject({ code: 'RIDE_ACCEPTANCE_CONFLICT' });
    expect((await repository.findById(fixture.rideIds[0]!))?.status).toBe('searching');
    expect((await repository.findById(fixture.rideIds[0]!))?.assignedDriverId).toBeNull();
  });

  it('consumes exactly one valid offer when the same driver has expired offered history', async () => {
    await pool.query(
      "INSERT INTO ride_dispatch_attempts(ride_id,attempt,driver_profile_id,status,expires_at) VALUES($1,2,$2,'offered',NOW()-INTERVAL '1 second')",
      [fixture.rideIds[0], fixture.driverProfileId],
    );
    await service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!);
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM ride_dispatch_attempts WHERE ride_id=$1 AND status='accepted'",
      [fixture.rideIds[0]],
    );
    expect(result.rows[0].count).toBe(1);
  });

  it('rejects a competing ride while the driver holds a live offer elsewhere', async () => {
    await cleanFixture(fixture);
    fixture = await createFixture(2);
    await pool.query(
      "INSERT INTO ride_dispatch_attempts(ride_id,attempt,driver_profile_id,status,expires_at) VALUES($1,1,$2,'offered',NOW()+INTERVAL '1 minute')",
      [fixture.rideIds[1], fixture.driverProfileId],
    );
    await expect(
      service.acceptRide(fixture.driverProfileId, fixture.rideIds[1]!),
    ).rejects.toMatchObject({ code: 'RIDE_ACCEPTANCE_CONFLICT' });
    expect((await repository.findById(fixture.rideIds[1]!))?.assignedDriverId).toBeNull();
  });

  it('keeps assignment and busy state consistent when acceptance races timeout', async () => {
    const [acceptance] = await Promise.allSettled([
      service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!),
      repository.finishDispatchAttempt(fixture.rideIds[0]!, fixture.driverProfileId, 'timed_out'),
    ]);
    const ride = (await repository.findById(fixture.rideIds[0]!))!;
    const accepted = await pool.query(
      "SELECT count(*)::int AS count FROM ride_dispatch_attempts WHERE ride_id=$1 AND status='accepted'",
      [ride.id],
    );
    if (acceptance.status === 'fulfilled') {
      expect(ride.assignedDriverId).toBe(fixture.driverProfileId);
      expect(accepted.rows[0].count).toBe(1);
    } else {
      expect(ride.assignedDriverId).toBeNull();
      expect(accepted.rows[0].count).toBe(0);
    }
  });

  it('releases busy state atomically when acceptance races cancellation', async () => {
    await Promise.allSettled([
      service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!),
      service.cancelRide(fixture.customerId, fixture.rideIds[0]!, { reason: 'concurrent cancel' }),
    ]);
    expect((await repository.findById(fixture.rideIds[0]!))?.status).toBe('cancelled');
    const driver = await pool.query('SELECT availability_status FROM driver_profiles WHERE id=$1', [
      fixture.driverProfileId,
    ]);
    expect(driver.rows[0].availability_status).toBe('available');
  });

  it('rejects acceptance after offer expiry without assigning a driver', async () => {
    await pool.query(
      "UPDATE ride_dispatch_attempts SET expires_at=NOW()-INTERVAL '1 second' WHERE ride_id=$1",
      [fixture.rideIds[0]],
    );
    await expect(
      service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!),
    ).rejects.toMatchObject({ code: 'RIDE_ACCEPTANCE_CONFLICT' });
    expect((await repository.findById(fixture.rideIds[0]!))?.assignedDriverId).toBeNull();
  });

  it('rejects acceptance after cancellation without accepting an offer', async () => {
    await service.cancelRide(fixture.customerId, fixture.rideIds[0]!, {
      reason: 'cancel before accept',
    });
    await expect(
      service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!),
    ).rejects.toMatchObject({ code: 'RIDE_ACCEPTANCE_CONFLICT' });
    const accepted = await pool.query(
      "SELECT count(*)::int AS count FROM ride_dispatch_attempts WHERE ride_id=$1 AND status='accepted'",
      [fixture.rideIds[0]],
    );
    expect(accepted.rows[0].count).toBe(0);
  });

  it('allows one driver to win only one competing ride', async () => {
    await cleanFixture(fixture);
    fixture = await createFixture(2);
    const results = await Promise.allSettled(
      fixture.rideIds.map((rideId) => service.acceptRide(fixture.driverProfileId, rideId)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const assigned = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM rides
       WHERE assigned_driver_id = $1 AND status = 'driver_assigned'`,
      [fixture.driverProfileId],
    );
    expect(assigned.rows[0]!.count).toBe('1');
  });

  it('makes duplicate cancellation converge on one cancelled state', async () => {
    await cleanFixture(fixture);
    fixture = await createFixture();
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        service.cancelRide(fixture.customerId, fixture.rideIds[0]!, { reason: 'duplicate test' }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const final = await pool.query<{ status: string }>(`SELECT status FROM rides WHERE id = $1`, [
      fixture.rideIds[0],
    ]);
    expect(final.rows[0]!.status).toBe('cancelled');
  });

  it('rejects invalid lifecycle transitions without changing the row', async () => {
    await expect(service.transitionRide(fixture.rideIds[0]!, 'completed')).rejects.toMatchObject({
      code: 'RIDE_TRANSITION_CONFLICT',
    });
    const final = await pool.query<{ status: string }>(`SELECT status FROM rides WHERE id = $1`, [
      fixture.rideIds[0],
    ]);
    expect(final.rows[0]!.status).toBe('searching');
  });
  it('does not restore a stale driver to available while an active ride exists', async () => {
    await service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!);

    await service.transitionRide(fixture.rideIds[0]!, 'driver_arriving', fixture.driverProfileId);

    await service.transitionRide(fixture.rideIds[0]!, 'driver_arrived', fixture.driverProfileId);

    await service.transitionRide(
      fixture.rideIds[0]!,
      'in_progress',
      fixture.driverProfileId,
      '7391',
    );

    await pool.query(
      `UPDATE driver_profiles
       SET availability_status = 'stale'
       WHERE id = $1`,
      [fixture.driverProfileId],
    );

    const updated = await driverRepository.updateLocation(fixture.driverProfileId, {
      latitude: 12.9717,
      longitude: 77.5947,
      recordedAt: new Date(),
    });

    expect(updated).toBe(true);

    const driver = await pool.query<{ availability_status: string }>(
      `SELECT availability_status
       FROM driver_profiles
       WHERE id = $1`,
      [fixture.driverProfileId],
    );

    expect(driver.rows[0]!.availability_status).toBe('stale');
    await service.completeRide(fixture.rideIds[0]!, fixture.driverProfileId);
    expect((await repository.findById(fixture.rideIds[0]!))?.status).toBe('completed');
    expect(
      (
        await pool.query('SELECT availability_status FROM driver_profiles WHERE id=$1', [
          fixture.driverProfileId,
        ])
      ).rows[0].availability_status,
    ).toBe('stale');
  });
  it('excludes drivers with active rides from nearby eligibility', async () => {
    await service.acceptRide(fixture.driverProfileId, fixture.rideIds[0]!);

    const candidates = await driverRepository.findNearbyEligible(
      12.9716,
      77.5946,
      2000,
      10,
      new Date(Date.now() - 60_000),
    );

    expect(
      candidates.some((candidate) => candidate.driverProfileId === fixture.driverProfileId),
    ).toBe(false);
  });
});
