import { remediateRouteContent } from '../map-operations.js';
import { randomUUID } from 'node:crypto';
import { RideDispatchService } from '../../rides/services/ride-dispatch.service.js';
import { MatchingService } from '../../rides/services/matching.service.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool, withTransaction } from '../../../infrastructure/database/postgres.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import { PostgresRideRepository } from '../../rides/repositories/ride.repository.js';
const live = process.env.RIDE_DB_TESTS === 'true' ? describe : describe.skip;
const drivers = new PostgresDriverRepository(pool),
  rides = new PostgresRideRepository(pool);
const origin = { latitude: 25.5941, longitude: 85.1376 };
live('map PostGIS discovery and route locks', () => {
  let userId: string, profileId: string, vehicleId: string;
  let base1: number, base2: number;
  const count = (radius: number) =>
    drivers.countNearbyEligible(
      origin.latitude,
      origin.longitude,
      radius,
      new Date(Date.now() - 30000),
      'passenger',
      'sedan',
    );
  beforeEach(async () => {
    base1 = await count(1000);
    base2 = await count(2000);
    const suffix = randomUUID();
    await withTransaction(async (client) => {
      const user = await client.query<{ id: string }>(
        "INSERT INTO users(first_name,last_name,phone,role) VALUES('MapAudit','Driver',$1,'driver') RETURNING id",
        [`+96${suffix.replaceAll('-', '').slice(0, 10)}`],
      );
      userId = user.rows[0]!.id;
      const profile = await client.query<{ id: string }>(
        "INSERT INTO driver_profiles(user_id,license_number,license_expiry,verification_status,availability_status,last_location,last_location_at) VALUES($1,$2,CURRENT_DATE+365,'approved','available',ST_Project(ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,1500,pi()/2),NOW()) RETURNING id",
        [userId, `MAP-${suffix}`, origin.longitude, origin.latitude],
      );
      profileId = profile.rows[0]!.id;
      const vehicle = await client.query<{ id: string }>(
        "INSERT INTO vehicles(driver_profile_id,make,model,plate_number,is_active,verification_status,sector,category) VALUES($1,'MapAudit','Fixture',$2,TRUE,'approved','passenger','sedan') RETURNING id",
        [profileId, `M-${suffix.slice(0, 12)}`],
      );
      vehicleId = vehicle.rows[0]!.id;
    });
  });
  afterEach(async () => {
    await pool.query('DELETE FROM rides WHERE assigned_driver_id=$1 OR customer_id=$2', [
      profileId,
      userId,
    ]);
    await pool.query('DELETE FROM vehicles WHERE id=$1', [vehicleId]);
    await pool.query('DELETE FROM driver_profiles WHERE id=$1', [profileId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  });
  it('distinguishes 1km and 2km and returns aggregate count without personal data', async () => {
    expect(await count(1000)).toBe(base1);
    expect(await count(2000)).toBe(base2 + 1);
    const found = await drivers.findNearbyEligible(
      origin.latitude,
      origin.longitude,
      2000,
      20,
      new Date(Date.now() - 30000),
      'passenger',
      'sedan',
    );
    expect(found.find((d) => d.driverProfileId === profileId)?.distanceMeters).toBeCloseTo(1500, 1);
  });
  it.each(['unavailable', 'busy', 'stale'])('excludes %s driver', async (status) => {
    await pool.query('UPDATE driver_profiles SET availability_status=$2 WHERE id=$1', [
      profileId,
      status,
    ]);
    expect(await count(2000)).toBe(base2);
  });
  it('excludes stale location despite available status', async () => {
    await pool.query('UPDATE driver_profiles SET last_location_at=$2 WHERE id=$1', [
      profileId,
      new Date(Date.now() - 31000),
    ]);
    expect(await count(2000)).toBe(base2);
  });
  it('excludes incompatible vehicle categories and inactive vehicles', async () => {
    await pool.query("UPDATE vehicles SET category='suv' WHERE id=$1", [vehicleId]);
    expect(await count(2000)).toBe(base2);
    await pool.query("UPDATE vehicles SET category='sedan',is_active=FALSE WHERE id=$1", [
      vehicleId,
    ]);
    expect(await count(2000)).toBe(base2);
  });
  it('excludes a driver with an active ride', async () => {
    await rides.create(userId, {
      pickup: origin,
      destination: { latitude: 25.6, longitude: 85.14 },
      sector: 'passenger',
      vehicleCategory: 'sedan',
      fareEstimate: 100,
    });
    await pool.query(
      "UPDATE rides SET status='driver_assigned',assigned_driver_id=$1,assigned_vehicle_id=$3 WHERE customer_id=$2",
      [profileId, userId, vehicleId],
    );
    expect(await count(2000)).toBe(base2);
  });
  it('uses an available-driver spatial index for bounded location queries', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan=off');
      const result = await client.query(
        "EXPLAIN (FORMAT JSON) SELECT id FROM driver_profiles WHERE availability_status='available' AND last_location IS NOT NULL AND ST_DWithin(last_location,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,2000)",
        [origin.longitude, origin.latitude],
      );
      expect(JSON.stringify(result.rows)).toContain('driver_profiles_available_location_gist_idx');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  it('rejects a late pickup route after trip start while retaining actual request time', async () => {
    const ride = await rides.create(userId, {
      pickup: origin,
      destination: { latitude: 25.6, longitude: 85.14 },
      sector: 'passenger',
      vehicleCategory: 'sedan',
      fareEstimate: 100,
    });
    const route = {
      lastCalculatedAt: 100,
      lastOrigin: origin,
      route: { distanceMeters: 1000, durationSeconds: 60 },
      segment: 'pickup' as const,
      routeVersion: 1,
      lastExternalRequestAt: 100,
    };
    expect(await rides.updateRouteMetadata(ride.id, route)).toBe(true);
    await pool.query(
      "UPDATE rides SET status='driver_assigned',assigned_driver_id=$1,assigned_vehicle_id=$2 WHERE id=$3",
      [profileId, vehicleId, ride.id],
    );
    await rides.transition(ride.id, 'driver_arriving', profileId);
    await rides.transition(ride.id, 'driver_arrived', profileId);
    await rides.transition(ride.id, 'in_progress', profileId);
    expect(
      await rides.updateRouteMetadata(ride.id, {
        ...route,
        routeVersion: 2,
        lastExternalRequestAt: 200,
      }),
    ).toBe(false);
    expect(await rides.getRouteMetadata(ride.id)).toMatchObject({
      routeVersion: 1,
      lastExternalRequestAt: 200,
    });
    expect(
      await rides.updateRouteMetadata(ride.id, {
        ...route,
        segment: 'destination',
        routeVersion: 3,
        lastExternalRequestAt: 300,
      }),
    ).toBe(true);
    expect(await rides.getRouteMetadata(ride.id)).toMatchObject({
      segment: 'destination',
      routeVersion: 3,
    });
  });
  it('allows only one simultaneous route worker and releases its advisory lock', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = rides.withRouteLock(profileId, async () => {
      started();
      await gate;
      return 'first';
    });
    await ready;
    try {
      expect(await rides.withRouteLock(profileId, async () => 'duplicate')).toBeNull();
    } finally {
      release();
    }
    expect(await first).toBe('first');
    expect(await rides.withRouteLock(profileId, async () => 'next')).toBe('next');
  });
  it('rejects stale route versions, changed targets and regressed cooldown time', async () => {
    const ride = await rides.create(userId, {
      pickup: origin,
      destination: { latitude: 25.6, longitude: 85.14 },
      sector: 'passenger',
      vehicleCategory: 'sedan',
      fareEstimate: 100,
    });
    const first = {
      externalRequestReservedAt: 400,
      lastCalculatedAt: 100,
      lastOrigin: origin,
      route: { distanceMeters: 1000, durationSeconds: 60 },
      segment: 'pickup' as const,
      destination: origin,
      routeVersion: 1,
      lastExternalRequestAt: 100,
    };
    expect(
      await rides.updateRouteMetadata(ride.id, { ...first, lastValidatedTimestamp: 1000 }, 0),
    ).toBe(true);
    expect(
      await rides.updateRouteMetadata(ride.id, { ...first, lastValidatedTimestamp: 999 }, 1),
    ).toBe(false);
    expect(
      await rides.updateRouteMetadata(
        ride.id,
        { ...first, routeVersion: 2, lastExternalRequestAt: 300 },
        1,
      ),
    ).toBe(true);
    expect(
      await rides.updateRouteMetadata(
        ride.id,
        { ...first, routeVersion: 3, lastExternalRequestAt: 200 },
        1,
      ),
    ).toBe(false);
    expect(await rides.getRouteMetadata(ride.id)).toMatchObject({
      routeVersion: 2,
      lastExternalRequestAt: 300,
    });
    expect(
      await rides.updateRouteMetadata(
        ride.id,
        { ...first, routeVersion: 3, destination: { latitude: 25.7, longitude: 85.2 } },
        2,
      ),
    ).toBe(false);
    expect(await rides.getRouteMetadata(ride.id)).toMatchObject({
      routeVersion: 2,
      destination: origin,
    });
    await rides.cancel(ride.id, userId, 'Audit cancellation');
    expect(await rides.updateRouteMetadata(ride.id, { ...first, routeVersion: 4 }, 2)).toBe(false);
    expect(await rides.getRouteMetadata(ride.id)).toMatchObject({ routeVersion: 2 });
  });
  it('enforces configured map radius at offer and acceptance after driver movement', async () => {
    const ride = await rides.create(userId, {
      pickup: origin,
      destination: { latitude: 25.6, longitude: 85.14 },
      sector: 'passenger',
      vehicleCategory: 'sedan',
      fareEstimate: 100,
    });
    const move = async (metres: number) =>
      pool.query(
        'UPDATE driver_profiles SET last_location=ST_Project(ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4::double precision,pi()/2),last_location_at=NOW() WHERE id=$1',
        [profileId, origin.longitude, origin.latitude, metres],
      );
    await move(3000);
    expect(await rides.offerDispatch(ride.id, profileId, 10000)).toBe(false);
    await move(1500);
    expect(await rides.offerDispatch(ride.id, profileId, 10000)).toBe(true);
    await move(3000);
    expect(await rides.accept(ride.id, profileId)).toBeNull();
    await move(1500);
    expect((await rides.accept(ride.id, profileId))?.assignedDriverId).toBe(profileId);
  });
  it('reconciles a crashed dispatch using durable expiry and resumes without duplicate offers', async () => {
    const ride = await rides.create(userId, {
      pickup: origin,
      destination: { latitude: 25.6, longitude: 85.14 },
      sector: 'passenger',
      vehicleCategory: 'sedan',
      fareEstimate: 100,
    });
    expect(await rides.offerDispatch(ride.id, profileId, 10000)).toBe(true);
    expect(await rides.reconcileDispatch(ride.id)).toBeNull(); // live lease is untouched
    await pool.query("UPDATE rides SET dispatch_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [
      ride.id,
    ]);
    expect((await rides.listRecoverableDispatch()).some((r) => r.id === ride.id)).toBe(true);
    const dispatcher = new RideDispatchService(
      rides,
      new MatchingService(drivers),
      () => {
        throw new Error('Must not repeat an old offer');
      },
      10,
    );
    try {
      await dispatcher.dispatch(ride);
    } finally {
      dispatcher.dispose();
    }
    expect((await rides.findById(ride.id))?.status).toBe('cancelled');
    const result = await pool.query('SELECT status FROM ride_dispatch_attempts WHERE ride_id=$1', [
      ride.id,
    ]);
    expect(result.rows).toEqual([{ status: 'timed_out' }]);
  });
  it('coordinates dispatch across independent repository instances and releases after failure', async () => {
    const other = new PostgresRideRepository(pool);
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = rides.withDispatchLock(profileId, async () => {
      started();
      await gate;
      return true;
    });
    await ready;
    expect(await other.withDispatchLock(profileId, async () => true)).toBeNull();
    release();
    expect(await first).toBe(true);
    await expect(
      other.withDispatchLock(profileId, async () => {
        throw new Error('Audit failure');
      }),
    ).rejects.toThrow('Audit failure');
    expect(await rides.withDispatchLock(profileId, async () => true)).toBe(true);
  });
  it('remediates only explicitly approved terminal provider fields while retaining business metadata', async () => {
    const ride = await rides.create(userId, {
      pickup: origin,
      destination: { latitude: 25.6, longitude: 85.14 },
      sector: 'passenger',
      vehicleCategory: 'sedan',
      fareEstimate: 100,
    });
    const business = {
      pin: '7391',
      fareEstimate: 100,
      sector: 'passenger',
      route: { distanceMeters: 100, durationSeconds: 10 },
      etaSeconds: 10,
      lastValidatedTimestamp: 123,
      customOwnerData: 'keep',
    };
    await pool.query('UPDATE rides SET route_metadata=$2::jsonb WHERE id=$1', [
      ride.id,
      JSON.stringify(business),
    ]);
    expect((await remediateRouteContent(pool, [ride.id], true, true)).changed).toBe(0); // active rides excluded
    await rides.cancel(ride.id, userId, 'test cleanup');
    expect(await remediateRouteContent(pool, [ride.id])).toEqual({
      mode: 'dry-run',
      eligible: 1,
      changed: 0,
    });
    expect((await rides.getRouteMetadata(ride.id))?.route).toEqual(business.route);
    expect((await remediateRouteContent(pool, [ride.id], true, true)).changed).toBe(1);
    const saved = (await pool.query('SELECT route_metadata FROM rides WHERE id=$1', [ride.id]))
      .rows[0].route_metadata;
    const { route: removedRoute, etaSeconds: removedEta, ...retained } = business;
    expect(removedRoute).toBeDefined();
    expect(removedEta).toBeDefined();
    expect(saved).toEqual(retained);
  });
  it('rejects direct discovery radius bypasses before SQL', async () => {
    await expect(
      drivers.findNearbyEligible(
        origin.latitude,
        origin.longitude,
        5000,
        20,
        new Date(Date.now() - 30000),
      ),
    ).rejects.toMatchObject({ code: 'MAP_INPUT_INVALID' });
  });
  it('records normal-planner EXPLAIN ANALYZE for actual candidate and count queries', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const recording = {
      query: async (sql: string, values: unknown[]) => {
        calls.push({ sql, values });
        return pool.query(sql, values);
      },
    };
    const repository = new PostgresDriverRepository(recording as never);
    await repository.findNearbyEligible(
      origin.latitude,
      origin.longitude,
      2000,
      20,
      new Date(Date.now() - 30000),
      'passenger',
      'sedan',
    );
    await repository.countNearbyEligible(
      origin.latitude,
      origin.longitude,
      2000,
      new Date(Date.now() - 30000),
      'passenger',
      'sedan',
    );
    const plans = [];
    for (const call of calls) {
      const result = await pool.query(
        'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + call.sql,
        call.values,
      );
      const plan = result.rows[0]['QUERY PLAN'][0];
      expect(plan['Plan']).toBeDefined();
      expect(plan['Execution Time']).toBeGreaterThanOrEqual(0);
      plans.push(plan);
    }
    // Tiny fixture tables may rationally use sequential scans. Record, never force.
    console.info(JSON.stringify({ event: 'map_real_query_plans', plans }));
  });
});

// Failure-path unit checks use no database and remain enabled without integration flags.
describe('advisory lock failure handling', () => {
  it('discards the session when advisory unlock fails', async () => {
    const error = new Error('Lost database connection');
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ locked: true }] })
        .mockRejectedValueOnce(error),
      release: vi.fn(),
    };
    const repository = new PostgresRideRepository({
      connect: async () => client,
      options: { max: 20 },
    } as never);
    await expect(repository.withRouteLock('id', async () => true)).rejects.toThrow(error);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(error);
  });
  it('does not start provider work when advisory acquisition fails', async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error('Database unavailable')),
      release: vi.fn(),
    };
    const work = vi.fn();
    const repository = new PostgresRideRepository({
      connect: async () => client,
      options: { max: 20 },
    } as never);
    await expect(repository.withRouteLock('id', work)).rejects.toThrow('Database unavailable');
    expect(work).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
