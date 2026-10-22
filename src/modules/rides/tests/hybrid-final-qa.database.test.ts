import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createServer as createTcpServer, connect as connectTcp } from 'node:net';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import { createServer } from 'node:http';
import { io as connect, type Socket } from 'socket.io-client';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import { driverUserRoom } from '../../../infrastructure/socket/socket.rooms.js';
import { PremiumCityAreas } from '../../maps/premium-city-areas.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { DriverService } from '../services/driver.service.js';
import { Redis } from 'ioredis';
import { startRideDispatchQueue } from '../../../infrastructure/queue/ride-dispatch.queue.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { RideService } from '../services/ride.service.js';
import { MatchingService } from '../services/matching.service.js';
import { RideDispatchService } from '../services/ride-dispatch.service.js';
import { rideEvents } from '../events/ride.events.js';
import { syntheticDispatchCity, syntheticDispatchAreas } from './dispatch-test-city.js';
import { requireDisposableAdministrativeDatabase } from '../../admin/tests/administrative-test-database.js';

// These cases create and delete approved synthetic fixtures; never run on a live DB.
if (process.env.RIDE_DB_TESTS === 'true') requireDisposableAdministrativeDatabase();

const evidence = process.env.DISPATCH_QA_EVIDENCE_DIR;
const repo = new PostgresRideRepository(pool, syntheticDispatchAreas),
  drivers = new PostgresDriverRepository(pool),
  service = new RideService(repo, drivers);
const users: string[] = [],
  profiles: string[] = [],
  vehicles: string[] = [],
  rides: string[] = [];
const controllers: RideDispatchService[] = [];
const queueCleanups: Array<() => Promise<void>> = [];
function record(id: string, data: Record<string, unknown>) {
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    appendFileSync(
      join(evidence, 'qa-observations.jsonl'),
      JSON.stringify({
        id,
        time: new Date().toISOString(),
        customers: users.length - profiles.length,
        drivers: profiles.length,
        vehicles: vehicles.length,
        ...data,
      }) + '\n',
    );
  }
}
async function customer() {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO users(id,first_name,last_name,role) VALUES($1,'Dispatch QA','TEST ONLY','customer')",
    [id],
  );
  users.push(id);
  return id;
}
async function driver(sector = 'passenger', category = 'sedan', distance = 100) {
  const userId = randomUUID(),
    profileId = randomUUID(),
    vehicleId = randomUUID();
  await pool.query(
    "INSERT INTO users(id,first_name,last_name,role) VALUES($1,'Dispatch QA','TEST ONLY','driver')",
    [userId],
  );
  users.push(userId);
  await pool.query(
    "INSERT INTO driver_profiles(id,user_id,license_number,license_expiry,verification_status) VALUES($1,$2,$3,CURRENT_DATE+365,'approved')",
    [profileId, userId, `TEST-${profileId}`],
  );
  profiles.push(profileId);
  await pool.query(
    "INSERT INTO vehicles(id,driver_profile_id,owner_id,make,model,plate_number,is_active,verification_status,sector,category) VALUES($1,$2,$3,'TEST ONLY','QA',$4,TRUE,'approved',$5,$6)",
    [vehicleId, profileId, userId, `QA${vehicleId.slice(0, 12)}`, sector, category],
  );
  vehicles.push(vehicleId);
  await pool.query(
    "UPDATE driver_profiles SET active_vehicle_id=$2,availability_status='available',last_location=ST_Project(ST_SetSRID(ST_MakePoint(77.5,13),4326)::geography,$3::float8,pi()/2),last_location_at=clock_timestamp() WHERE id=$1",
    [profileId, vehicleId, distance],
  );
  return { userId, profileId, vehicleId };
}
async function ride(customerId: string, sector = 'passenger', category = 'sedan') {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO rides(id,customer_id,status,sector,vehicle_category,pin,pickup_location,destination_location) VALUES($1,$2,'searching',$3,$4,'1234',ST_SetSRID(ST_MakePoint(77.5,13),4326)::geography,ST_SetSRID(ST_MakePoint(77.51,13),4326)::geography)",
    [id, customerId, sector, category],
  );
  rides.push(id);
  return (await repo.findById(id))!;
}
async function expire(id: string) {
  await pool.query(
    "UPDATE rides SET dispatch_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
    [id],
  );
  await pool.query(
    "UPDATE ride_dispatch_attempts SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE ride_id=$1 AND status='offered'",
    [id],
  );
}
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  for (const cleanup of queueCleanups.splice(0)) await cleanup();
  if (rides.length)
    await pool.query('DELETE FROM rides WHERE id=ANY($1::uuid[])', [rides.splice(0)]);
  if (vehicles.length)
    await pool.query('DELETE FROM vehicles WHERE id=ANY($1::uuid[])', [vehicles.splice(0)]);
  if (profiles.length)
    await pool.query('DELETE FROM driver_profiles WHERE id=ANY($1::uuid[])', [profiles.splice(0)]);
  if (users.length) {
    const ids = users.splice(0);
    await pool.query('DELETE FROM provider_approval_requests WHERE requester_id=ANY($1::uuid[])', [
      ids,
    ]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
  }
});
const policies = [
  ['passenger', 'sedan', 25000],
  ['logistics', 'mini_truck', 120000],
  ['service', 'towing', 600000],
  ['service', 'towing_van', 600000],
  ['premium', 'sedan', 3600000],
  ['service', 'ambulance', 30000],
] as const;
describe.skipIf(process.env.RIDE_DB_TESTS !== 'true')('Hybrid dispatch final QA', () => {
  it('HD-LOCK-DEADLINE: acceptance waiting on a row lock cannot win after expiry', async () => {
    const c = await customer(),
      d = await driver(),
      r = await ride(c);
    expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
    await pool.query(
      "UPDATE rides SET dispatch_expires_at=clock_timestamp()+INTERVAL '250 milliseconds' WHERE id=$1",
      [r.id],
    );
    await pool.query(
      'UPDATE ride_dispatch_attempts SET expires_at=(SELECT dispatch_expires_at FROM rides WHERE id=$1) WHERE ride_id=$1',
      [r.id],
    );
    const locker = await pool.connect();
    await locker.query('BEGIN');
    await locker.query('SELECT id FROM rides WHERE id=$1 FOR UPDATE', [r.id]);
    const acceptance = service.acceptRide(d.profileId, r.id).then(
      (value) => ({ value, error: null as any }),
      (error) => ({ value: null, error }),
    );
    try {
      await vi.waitFor(async () => {
        const blocked = await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()",
        );
        expect(blocked.rows[0].n).toBeGreaterThan(0);
      });
      await vi.waitFor(async () => {
        const expired = await pool.query(
          'SELECT dispatch_expires_at<clock_timestamp() AS expired FROM rides WHERE id=$1',
          [r.id],
        );
        expect(expired.rows[0].expired).toBe(true);
      });
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
    const result = await acceptance;
    expect(result.error).toMatchObject({ statusCode: 409 });
    expect(result.value).toBeNull();
    expect((await repo.findById(r.id))?.status).toBe('searching');
    record('HD-LOCK-DEADLINE', { lateAfterLock: '409', partialAssignment: false });
  });
  it('HD-ENGINE-LOAD-50: actual coordinator dispatches fifty customers across one hundred eligible drivers', async () => {
    const cs: string[] = [],
      ds = [] as Awaited<ReturnType<typeof driver>>[],
      rs = [] as Awaited<ReturnType<typeof ride>>[];
    for (let i = 0; i < 50; i++) cs.push(await customer());
    for (let i = 0; i < 100; i++) ds.push(await driver());
    for (const c of cs) rs.push(await ride(c));
    const notified: Array<{ ride: string; driver: string; elapsed: number }> = [],
      started = performance.now();
    const controller = new RideDispatchService(
      repo,
      new MatchingService(drivers),
      async (candidate, ride) => {
        notified.push({
          ride: ride.id,
          driver: candidate.driverProfileId,
          elapsed: performance.now() - started,
        });
        await service.acceptRide(candidate.driverProfileId, ride.id);
      },
    );
    controllers.push(controller);
    controller.startRecovery();
    await Promise.all(rs.map((r) => controller.dispatch(r)));
    await vi.waitFor(
      async () => {
        const state = await pool.query(
          "SELECT count(*)::int AS n,count(DISTINCT assigned_driver_id)::int AS drivers FROM rides WHERE id=ANY($1::uuid[]) AND status='driver_assigned'",
          [rs.map((r) => r.id)],
        );
        expect(state.rows[0]).toEqual({ n: 50, drivers: 50 });
      },
      { timeout: 20000, interval: 100 },
    );
    expect(notified).toHaveLength(50);
    expect(new Set(notified.map((n) => n.ride + '|' + n.driver)).size).toBe(50);
    const history = await pool.query(
      "SELECT count(*)::int AS n FROM ride_dispatch_attempts WHERE ride_id=ANY($1::uuid[]) AND status='accepted'",
      [rs.map((r) => r.id)],
    );
    expect(history.rows[0].n).toBe(50);
    const values = notified.map((n) => n.elapsed).sort((a, b) => a - b);
    record('HD-ENGINE-LOAD-50', {
      customers: 50,
      drivers: 100,
      vehicles: 100,
      rides: 50,
      offers: notified.length,
      notifications: notified.length,
      assignments: 50,
      duplicateAssignments: 0,
      notificationMs: { median: values[24], p95: values[47], p99: values[49] },
      totalMs: performance.now() - started,
      recoveryIntervalMs: 5000,
      outcomes: notified,
    });
  }, 30000);
  it.each(policies)(
    'HD-EMPTY-%s-%s: exhausted search cancels without inventing an assignment',
    async (sector, category) => {
      const c = await customer(),
        r = await ride(c, sector, category),
        notify = vi.fn();
      const controller = new RideDispatchService(
        repo,
        new MatchingService(drivers, undefined, undefined, {
          resolve: async () => syntheticDispatchCity,
        }),
        notify,
      );
      controllers.push(controller);
      await controller.dispatch(r);
      expect((await repo.findById(r.id))?.status).toBe('cancelled');
      expect(notify).not.toHaveBeenCalled();
      record(`HD-EMPTY-${sector}-${category}`, {
        finalState: 'cancelled',
        offers: 0,
        assignments: 0,
      });
    },
  );
  it('HD-AMBULANCE-REJECT: next nearest is offered immediately without repeating the rejector', async () => {
    const c = await customer(),
      a = await driver('service', 'ambulance', 100),
      b = await driver('service', 'ambulance', 200),
      r = await ride(c, 'service', 'ambulance'),
      notified: string[] = [],
      start = performance.now();
    const controller = new RideDispatchService(
      repo,
      new MatchingService(drivers),
      async (candidate) => {
        notified.push(candidate.driverProfileId);
        if (candidate.driverProfileId === a.profileId) await service.rejectRide(a.profileId, r.id);
        else await service.acceptRide(candidate.driverProfileId, r.id);
      },
    );
    controllers.push(controller);
    await controller.dispatch(r);
    expect(notified).toEqual([a.profileId, b.profileId]);
    expect(performance.now() - start).toBeLessThan(3000);
    record('HD-AMBULANCE-REJECT', { notified, progressionMs: performance.now() - start });
  });
  it('HD-DRIVER-CONTENTION: competing rides cannot lease or assign the same driver twice', async () => {
    const a = await customer(),
      b = await customer(),
      d = await driver(),
      ra = await ride(a),
      rb = await ride(b);
    const offers = await Promise.all([
      repo.offerDispatch(ra.id, d.profileId, 1),
      repo.offerDispatch(rb.id, d.profileId, 1),
    ]);
    expect(offers.filter(Boolean)).toHaveLength(1);
    const winner = offers[0] ? ra : rb,
      accepts = await Promise.allSettled(
        Array.from({ length: 6 }, () => service.acceptRide(d.profileId, winner.id)),
      );
    expect(accepts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT id FROM rides WHERE assigned_driver_id=$1 AND status NOT IN('completed','cancelled')",
          [d.profileId],
        )
      ).rowCount,
    ).toBe(1);
    record('HD-DRIVER-CONTENTION', {
      offers,
      accepts: accepts.map((a) => a.status),
      winningRide: winner.id,
      driver: d.profileId,
    });
  });
  it('HD-ROLLBACK: availability failure rolls back assignment and offer consumption', async () => {
    const c = await customer(),
      d = await driver(),
      r = await ride(c);
    expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
    const failing = new RideService(repo, { setBusy: async () => false } as never);
    await expect(failing.acceptRide(d.profileId, r.id)).rejects.toMatchObject({
      code: 'DRIVER_CONTENTION_CONFLICT',
      statusCode: 409,
    });
    expect((await repo.findById(r.id))?.status).toBe('searching');
    expect(
      (await pool.query('SELECT status FROM ride_dispatch_attempts WHERE ride_id=$1', [r.id]))
        .rows[0].status,
    ).toBe('offered');
    expect(
      (
        await pool.query('SELECT availability_status FROM driver_profiles WHERE id=$1', [
          d.profileId,
        ])
      ).rows[0].availability_status,
    ).toBe('available');
    record('HD-ROLLBACK', {
      rideState: 'searching',
      attemptState: 'offered',
      driverState: 'available',
    });
  });
  it('HD-SOCKET-RECONNECT: pending customer reconnect preserves ownership and does not duplicate an offer', async () => {
    const c = await customer(),
      other = await customer(),
      d = await driver(),
      r = await ride(c);
    expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
    const http = createServer(),
      io = createSocketServer(http, {
        driverService: new DriverService(drivers, undefined, repo),
        rideRepository: repo,
        rideService: service,
        routeRecalculationService: {} as never,
      });
    const sockets: Socket[] = [];
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw Error('QA socket address missing');
    const open = async (id: string) => {
      const token = await signAccessToken({ sub: id, role: 'customer', type: 'access' });
      const socket = connect(`http://127.0.0.1:${address.port}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return socket;
    };
    const joinRide = (socket: Socket) =>
      new Promise<any>((resolve) => socket.emit('ride:join', r.id, resolve));
    try {
      const first = await open(c);
      expect(await joinRide(first)).toMatchObject({ success: true });
      first.disconnect();
      const replacement = await open(c);
      expect(await joinRide(replacement)).toMatchObject({ success: true });
      expect(await joinRide(await open(other))).toMatchObject({ success: false });
      expect(
        (await pool.query('SELECT ride_id FROM ride_dispatch_attempts WHERE ride_id=$1', [r.id]))
          .rowCount,
      ).toBe(1);
      record('HD-SOCKET-RECONNECT', { customerReconnected: true, outsiderDenied: true, offers: 1 });
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });
  it('HD-INVALID-GEO: invalid query coordinates are rejected before spatial matching', async () => {
    await expect(
      drivers.findNearbyEligible(Number.NaN, 77, 2000, 20, new Date()),
    ).rejects.toMatchObject({ code: 'MAP_INPUT_INVALID', statusCode: 400 });
    await expect(drivers.findNearbyEligible(91, 181, 2000, 20, new Date())).rejects.toMatchObject({
      code: 'MAP_INPUT_INVALID',
      statusCode: 400,
    });
    record('HD-INVALID-GEO', { invalidQueriesRejected: 2 });
  });
  it.each(policies)(
    'HD-QUEUE-%s-%s: actual PostgreSQL deadline survives queue callback and worker replacement',
    async (sector, category) => {
      const c = await customer(),
        d = await driver(sector, category),
        r = await ride(c, sector, category);
      expect(
        await repo.offerDispatch(
          r.id,
          d.profileId,
          1,
          sector === 'premium' ? syntheticDispatchCity : undefined,
        ),
      ).toBe(true);
      const url = process.env.DISPATCH_QA_REDIS_URL || 'redis://127.0.0.1:6379',
        name = `dispatch-qa-${randomUUID()}`,
        connection = new Redis(url, { maxRetriesPerRequest: 0 }),
        inspection = new Queue(name, { connection }),
        progress = { dispatch: vi.fn(async () => {}) };
      let worker = startRideDispatchQueue(url, repo, progress, name);
      queueCleanups.push(async () => {
        await worker.close();
        await inspection.obliterate({ force: true });
        await inspection.close();
        connection.disconnect();
      });
      const early = new Date(Date.now() - 1000),
        earlyId = `${r.id}-${d.profileId}-${early.getTime()}`;
      await vi.waitFor(() => worker.schedule(r.id, d.profileId, early));
      await vi.waitFor(async () =>
        expect(await (await inspection.getJob(earlyId))?.getState()).toBe('completed'),
      );
      expect(await repo.pendingDispatch(r.id)).not.toBeNull();
      expect(progress.dispatch).not.toHaveBeenCalled();
      await expire(r.id);
      const deadline = new Date(Date.now() + 150),
        start = performance.now();
      await worker.schedule(r.id, d.profileId, deadline);
      await worker.close();
      worker = startRideDispatchQueue(url, repo, progress, name);
      await vi.waitFor(() => expect(progress.dispatch).toHaveBeenCalledTimes(1));
      const history = await pool.query(
        'SELECT status FROM ride_dispatch_attempts WHERE ride_id=$1',
        [r.id],
      );
      expect(history.rows[0].status).toBe('timed_out');
      record(`HD-QUEUE-${sector}-${category}`, {
        queue: name,
        earlyPayloadDidNotExpire: true,
        workerReplaced: true,
        queueObservedMs: performance.now() - start,
        history: history.rows,
        deadlineJobId: `${r.id}-${d.profileId}-${deadline.getTime()}`,
      });
    },
  );
  it.each(policies)(
    'HD-TIME-%s-%s: authoritative interval, early expiry, late acceptance, exclusion',
    async (sector, category, ms) => {
      const c = await customer(),
        d = await driver(sector, category),
        r = await ride(c, sector, category);
      expect(
        await repo.offerDispatch(
          r.id,
          d.profileId,
          1,
          sector === 'premium' ? syntheticDispatchCity : undefined,
        ),
      ).toBe(true);
      const times = await pool.query(
        'SELECT offered_at,expires_at,EXTRACT(EPOCH FROM(expires_at-offered_at))*1000 AS ms FROM ride_dispatch_attempts WHERE ride_id=$1',
        [r.id],
      );
      expect(Number(times.rows[0].ms)).toBe(ms);
      expect(await repo.finishDispatchAttempt(r.id, d.profileId, 'timed_out')).toBe(false);
      await expire(r.id);
      await expect(service.acceptRide(d.profileId, r.id)).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(await repo.finishDispatchAttempt(r.id, d.profileId, 'timed_out')).toBe(true);
      expect(
        await repo.offerDispatch(
          r.id,
          d.profileId,
          ms,
          sector === 'premium' ? syntheticDispatchCity : undefined,
        ),
      ).toBe(false);
      record(`HD-TIME-${sector}-${category}`, {
        expectedMs: ms,
        actualMs: Number(times.rows[0].ms),
        ...times.rows[0],
        earlyExpiry: false,
        lateAcceptance: '409',
        sameRideReoffer: false,
      });
    },
  );
  it.each(['missing', 'incorrect'])(
    'HD-CITY-%s: refuses corrupt persisted premium city identity',
    async (kind) => {
      const c = await customer(),
        d = await driver('premium'),
        r = await ride(c, 'premium');
      expect(await repo.offerDispatch(r.id, d.profileId, 1, syntheticDispatchCity)).toBe(true);
      await pool.query('UPDATE ride_dispatch_attempts SET city_id=$2 WHERE ride_id=$1', [
        r.id,
        kind === 'missing' ? null : 'NOT_THE_APPROVED_CITY',
      ]);
      await expect(service.acceptRide(d.profileId, r.id)).rejects.toMatchObject({
        statusCode: 409,
      });
      record(`HD-CITY-${kind}`, { acceptance: '409', persistedCity: kind });
    },
  );
  it('HD-CITY-FORGE: unregistered city identity cannot create a premium offer', async () => {
    const c = await customer(),
      d = await driver('premium'),
      r = await ride(c, 'premium');
    expect(
      await repo.offerDispatch(r.id, d.profileId, 1, {
        ...syntheticDispatchCity,
        cityId: 'UNREGISTERED_CITY',
      }),
    ).toBe(false);
    expect(
      await pool.query('SELECT ride_id FROM ride_dispatch_attempts WHERE ride_id=$1', [r.id]),
    ).toMatchObject({ rowCount: 0 });
    record('HD-CITY-FORGE', { unregisteredOffer: false });
  });
  it.each([
    ['passenger', 'sedan', [2000, 5000, 10000]],
    ['logistics', 'mini_truck', [7000, 15000, 20000]],
    ['service', 'towing', [10000, 15000, 20000]],
  ] as const)(
    'HD-GEO-%s-%s: inside, exact and outside all wave edges',
    async (sector, category, radii) => {
      const c = await customer(),
        d = await driver(sector, category),
        r = await ride(c, sector, category),
        observations = [];
      for (const radius of radii)
        for (const delta of [-0.01, 0, 0.01]) {
          await pool.query(
            'UPDATE driver_profiles SET last_location=ST_Project(ST_SetSRID(ST_MakePoint(77.5,13),4326)::geography,$2::float8,pi()/2) WHERE id=$1',
            [d.profileId, radius + delta],
          );
          const found = await drivers.findNearbyEligible(
            13,
            77.5,
            radius,
            20,
            new Date(Date.now() - 30000),
            sector,
            category,
            { rideId: r.id, radiusMeters: radius },
          );
          const included = found.some((v) => v.driverProfileId === d.profileId);
          expect(included).toBe(delta <= 0);
          observations.push({ radius, delta, included });
        }
      record(`HD-GEO-${sector}-${category}`, { observations });
    },
  );
  it.each([
    ['passenger', 'sedan', [2000, 5000, 10000]],
    ['logistics', 'mini_truck', [7000, 15000, 20000]],
    ['service', 'towing', [10000, 15000, 20000]],
  ] as const)(
    'HD-WAVES-%s-%s: actual spatial matching and immediate rejection through all waves',
    async (sector, category, radii) => {
      const c = await customer(),
        r = await ride(c, sector, category),
        ds = [];
      for (const radius of radii) ds.push(await driver(sector, category, radius - 100));
      const offers: string[] = [],
        times: number[] = [],
        started = performance.now();
      const controller = new RideDispatchService(
        repo,
        new MatchingService(drivers),
        async (candidate) => {
          offers.push(candidate.driverProfileId);
          times.push(performance.now() - started);
          await service.rejectRide(candidate.driverProfileId, r.id);
        },
      );
      controllers.push(controller);
      await controller.dispatch(r);
      expect(offers).toEqual(ds.map((d) => d.profileId));
      expect(new Set(offers).size).toBe(3);
      expect((await repo.findById(r.id))?.status).toBe('cancelled');
      expect(times[2]!).toBeLessThan(5000);
      record(`HD-WAVES-${sector}-${category}`, {
        radii,
        offerDrivers: offers,
        offerElapsedMs: times,
        finalState: 'cancelled',
      });
    },
  );
  it.each(policies)(
    'HD-RECOVER-%s-%s: elapsed persisted offer advances after coordinator replacement',
    async (sector, category) => {
      const c = await customer(),
        first = await driver(sector, category, 100),
        next = await driver(sector, category, 200),
        r = await ride(c, sector, category);
      expect(
        await repo.offerDispatch(
          r.id,
          first.profileId,
          1,
          sector === 'premium' ? syntheticDispatchCity : undefined,
        ),
      ).toBe(true);
      await expire(r.id);
      const notified: string[] = [],
        matching = new MatchingService(drivers, undefined, undefined, {
          resolve: async () => syntheticDispatchCity,
        });
      const controller = new RideDispatchService(repo, matching, async (candidate) => {
        notified.push(candidate.driverProfileId);
        await service.acceptRide(candidate.driverProfileId, r.id);
      });
      controllers.push(controller);
      const started = performance.now();
      await controller.dispatch(r);
      expect(notified).toEqual([next.profileId]);
      const history = await pool.query(
        'SELECT driver_profile_id,status FROM ride_dispatch_attempts WHERE ride_id=$1 ORDER BY attempt',
        [r.id],
      );
      expect(history.rows.map((row) => row.status)).toEqual(['timed_out', 'accepted']);
      record(`HD-RECOVER-${sector}-${category}`, {
        notified,
        history: history.rows,
        recoveryMs: performance.now() - started,
      });
    },
  );
  it.each([
    'missing',
    'stale',
    'unavailable',
    'unapproved',
    'expired_licence',
    'expired_registration',
    'incompatible',
  ])('HD-ELIG-%s: nearer ineligible ambulance is excluded', async (reason) => {
    const c = await customer(),
      bad = await driver('service', 'ambulance', 100),
      good = await driver('service', 'ambulance', 200),
      r = await ride(c, 'service', 'ambulance');
    const changes: Record<string, [string, unknown[]]> = {
      missing: [
        'UPDATE driver_profiles SET last_location=NULL,last_location_at=NULL WHERE id=$1',
        [bad.profileId],
      ],
      stale: [
        "UPDATE driver_profiles SET last_location_at=NOW()-INTERVAL '1 day' WHERE id=$1",
        [bad.profileId],
      ],
      unavailable: [
        "UPDATE driver_profiles SET availability_status='unavailable' WHERE id=$1",
        [bad.profileId],
      ],
      unapproved: [
        "UPDATE driver_profiles SET verification_status='pending' WHERE id=$1",
        [bad.profileId],
      ],
      expired_licence: [
        'UPDATE driver_profiles SET license_expiry=CURRENT_DATE-1 WHERE id=$1',
        [bad.profileId],
      ],
      expired_registration: [
        'UPDATE vehicles SET registration_expiry=CURRENT_DATE-1 WHERE id=$1',
        [bad.vehicleId],
      ],
      incompatible: ["UPDATE vehicles SET category='towing' WHERE id=$1", [bad.vehicleId]],
    };
    const [sql, params] = changes[reason]!;
    await pool.query(sql, params);
    const found = await new MatchingService(drivers).findDispatchDrivers(r, null);
    expect(found.map((d) => d.driverProfileId)).toEqual([good.profileId]);
    record(`HD-ELIG-${reason}`, { nearestExcluded: bad.profileId, selected: good.profileId });
  });
  it('HD-COORDINATOR-DUP: duplicate dispatch calls notify once and leave one offer', async () => {
    const c = await customer(),
      d = await driver(),
      r = await ride(c),
      notify = vi.fn(async (candidate) => {
        await service.acceptRide(candidate.driverProfileId, r.id);
      });
    const controller = new RideDispatchService(repo, new MatchingService(drivers), notify);
    controllers.push(controller);
    await Promise.all(Array.from({ length: 10 }, () => controller.dispatch(r)));
    expect(notify).toHaveBeenCalledTimes(1);
    const history = await pool.query('SELECT status FROM ride_dispatch_attempts WHERE ride_id=$1', [
      r.id,
    ]);
    expect(history.rows).toEqual([{ status: 'accepted' }]);
    record('HD-COORDINATOR-DUP', {
      dispatchCalls: 10,
      notifications: 1,
      history: history.rows,
      driver: d.profileId,
    });
  });
  it('HD-PENDING-UNAVAILABLE: promptly advances when the pending ambulance becomes unavailable', async () => {
    const c = await customer(),
      a = await driver('service', 'ambulance', 100),
      b = await driver('service', 'ambulance', 200),
      r = await ride(c, 'service', 'ambulance');
    const notified: string[] = [],
      start = performance.now();
    const controller = new RideDispatchService(
      repo,
      new MatchingService(drivers),
      async (candidate) => {
        notified.push(candidate.driverProfileId);
        if (candidate.driverProfileId === a.profileId)
          await pool.query(
            "UPDATE driver_profiles SET availability_status='unavailable' WHERE id=$1",
            [a.profileId],
          );
        else await service.acceptRide(candidate.driverProfileId, r.id);
      },
    );
    controllers.push(controller);
    const work = controller.dispatch(r);
    await vi.waitFor(() => expect(notified).toEqual([a.profileId, b.profileId]), { timeout: 3000 });
    await work;
    record('HD-PENDING-UNAVAILABLE', { notified, progressionMs: performance.now() - start });
  });
  it('HD-PROCESS-RESTART: recover after a real dispatch subprocess is terminated', async () => {
    const c = await customer(),
      a = await driver(),
      b = await driver('passenger', 'sedan', 200),
      r = await ride(c);
    expect(await repo.offerDispatch(r.id, a.profileId, 1)).toBe(true);
    const worker = fileURLToPath(new URL('./dispatch-qa-process.fixture.ts', import.meta.url));
    const startChild = (mode: string) =>
      fork(worker, [r.id, mode], {
        execArgv: ['--import', 'tsx'],
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
    const first = startChild('pending');
    let stderr = '';
    first.stderr?.on('data', (chunk) => (stderr += chunk));
    const waitMessage = (child: ReturnType<typeof fork>) =>
      new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(Error('QA subprocess timeout: ' + stderr));
        }, 10000);
        child.once('message', (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    try {
      expect(await waitMessage(first)).toMatchObject({ state: 'pending' });
      await new Promise<void>((resolve) => {
        first.once('exit', () => resolve());
        first.kill();
      });
      await expire(r.id);
      const start = performance.now(),
        second = startChild('recover');
      second.stderr?.on('data', (chunk) => (stderr += chunk));
      try {
        expect(await waitMessage(second)).toMatchObject({
          state: 'accepted',
          driverProfileId: b.profileId,
        });
        await new Promise<void>((resolve) => {
          if (second.exitCode !== null) resolve();
          else second.once('exit', () => resolve());
        });
      } finally {
        if (second.exitCode === null) second.kill();
      }
      record('HD-PROCESS-RESTART', {
        terminatedProcess: true,
        replacementProcess: true,
        recoveryMs: performance.now() - start,
        winner: b.profileId,
        duplicateOffers: 0,
      });
    } finally {
      if (first.exitCode === null && !first.killed) first.kill();
    }
  }, 20000);
  it('HD-RACE-REJECT-TIMEOUT: one terminal attempt under competing callbacks', async () => {
    const c = await customer(),
      d = await driver(),
      r = await ride(c);
    expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
    await expire(r.id);
    const results = await Promise.all([
      repo.finishDispatchAttempt(r.id, d.profileId, 'rejected'),
      repo.finishDispatchAttempt(r.id, d.profileId, 'timed_out'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const state = await pool.query('SELECT status FROM ride_dispatch_attempts WHERE ride_id=$1', [
      r.id,
    ]);
    expect(state.rows[0].status).toBe('timed_out');
    record('HD-RACE-REJECT-TIMEOUT', { results, state: state.rows });
  });
  it('HD-RACE-ACCEPT-CANCEL: cancellation and acceptance preserve consistent final state', async () => {
    const c = await customer(),
      d = await driver(),
      r = await ride(c);
    expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
    const result = await Promise.allSettled([
      service.acceptRide(d.profileId, r.id),
      service.cancelRide(c, r.id, { reason: 'TEST ONLY race' }),
    ]);
    expect(result[1]?.status).toBe('fulfilled');
    expect((await repo.findById(r.id))?.status).toBe('cancelled');
    const status = await pool.query('SELECT availability_status FROM driver_profiles WHERE id=$1', [
      d.profileId,
    ]);
    expect(status.rows[0].availability_status).toBe('available');
    expect(await repo.finishDispatchAttempt(r.id, d.profileId, 'timed_out')).toBe(false);
    record('HD-RACE-ACCEPT-CANCEL', {
      results: result.map((r) => r.status),
      finalState: 'cancelled',
      driverStatus: status.rows[0].availability_status,
    });
  });
  it('HD-EXCLUDE: rejection is ride-specific across two customers', async () => {
    const a = await customer(),
      b = await customer(),
      d = await driver(),
      ra = await ride(a),
      rb = await ride(b);
    expect(await repo.offerDispatch(ra.id, d.profileId, 1)).toBe(true);
    await service.rejectRide(d.profileId, ra.id);
    expect(await repo.offerDispatch(ra.id, d.profileId, 1)).toBe(false);
    expect(await repo.offerDispatch(rb.id, d.profileId, 1)).toBe(true);
    expect(await repo.findByIdForCustomer(ra.id, b)).toBeNull();
    await expect(service.cancelRide(b, ra.id, { reason: 'TEST ONLY' })).rejects.toMatchObject({
      statusCode: 404,
    });
    record('HD-EXCLUDE', {
      rideA: ra.id,
      rideB: rb.id,
      driver: d.profileId,
      reofferA: false,
      offerB: true,
      crossCustomerRead: false,
    });
  });
  it.each([1, 5, 10, 25, 50])(
    'HD-LOAD-%i: isolated customers and twice as many competing drivers',
    async (count) => {
      const start = performance.now(),
        cpu = process.cpuUsage(),
        memoryStart = process.memoryUsage().rss;
      const cs = [] as string[],
        ds = [] as Awaited<ReturnType<typeof driver>>[],
        rs = [] as Awaited<ReturnType<typeof ride>>[];
      for (let i = 0; i < count; i++) cs.push(await customer());
      for (let i = 0; i < count * 2; i++) ds.push(await driver());
      for (const c of cs) rs.push(await ride(c));
      const dispatchLatencies: number[] = [],
        acceptLatencies: number[] = [],
        outcomes: unknown[] = [];
      const queryLatencies: number[] = [];
      let sampleQuery: { sql: string; values: unknown[] } | undefined;
      const measuredDrivers = new PostgresDriverRepository({
        query: async (sql: string, values: unknown[]) => {
          const started = performance.now();
          const result = await pool.query(sql, values);
          queryLatencies.push(performance.now() - started);
          sampleQuery ??= { sql, values };
          return result;
        },
      } as never);
      const matching = new MatchingService(measuredDrivers);
      await Promise.all(
        rs.map(async (r, i) => {
          const t = performance.now();
          const found = await matching.findDispatchDrivers(r, 2000);
          expect(found.length).toBeGreaterThan(0);
          expect(await repo.offerDispatch(r.id, ds[i]!.profileId, 1)).toBe(true);
          dispatchLatencies.push(performance.now() - t);
        }),
      );
      await Promise.all(
        rs.map(async (r, i) => {
          const t = performance.now();
          const results = await Promise.allSettled([
            service.acceptRide(ds[i]!.profileId, r.id),
            service.acceptRide(ds[i]!.profileId, r.id),
            service.acceptRide(ds[count + i]!.profileId, r.id),
          ]);
          acceptLatencies.push(performance.now() - t);
          expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
          expect(
            results
              .filter((x) => x.status === 'rejected')
              .every((x) => (x as PromiseRejectedResult).reason.statusCode === 409),
          ).toBe(true);
          outcomes.push({
            rideId: r.id,
            winner: ds[i]!.profileId,
            results: results.map((x) =>
              x.status === 'fulfilled'
                ? 'assigned'
                : { status: x.reason.statusCode, code: x.reason.code },
            ),
          });
        }),
      );
      const consistency = await pool.query(
        'SELECT assigned_driver_id,count(*)::int AS n FROM rides WHERE id=ANY($1::uuid[]) GROUP BY assigned_driver_id',
        [rs.map((r) => r.id)],
      );
      expect(consistency.rows.every((row) => row.n === 1 && row.assigned_driver_id)).toBe(true);
      const busy = await pool.query(
        "SELECT count(*)::int AS n FROM driver_profiles WHERE id=ANY($1::uuid[]) AND availability_status='busy'",
        [ds.map((d) => d.profileId)],
      );
      expect(busy.rows[0].n).toBe(count);
      const percentile = (values: number[], p: number) =>
        [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)]!;
      const latency = (values: number[]) => ({
        median: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99),
      });
      record(`HD-LOAD-${count}`, {
        customers: count,
        drivers: count * 2,
        vehicles: count * 2,
        rides: count,
        offers: count,
        concurrentDispatches: count,
        concurrentAcceptanceCalls: count * 3,
        assignments: count,
        rejectedAcceptanceCalls: count * 2,
        duplicateAssignments: 0,
        dispatchMs: latency(dispatchLatencies),
        acceptMs: latency(acceptLatencies),
        candidateQueryMs: latency(queryLatencies),
        candidateQueryCount: queryLatencies.length,
        slowCandidateQueriesOver100Ms: queryLatencies.filter((ms) => ms > 100).length,
        elapsedMs: performance.now() - start,
        cpuMicroseconds: process.cpuUsage(cpu),
        memoryStartBytes: memoryStart,
        memoryEndBytes: process.memoryUsage().rss,
        outcomes,
      });
      if (sampleQuery) {
        const plan = await pool.query(
          'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + sampleQuery.sql,
          sampleQuery.values,
        );
        record(`HD-PLAN-${count}`, { plan: plan.rows[0]['QUERY PLAN'] });
      }
    },
    30000,
  );
  it('HD-RECOVERY: application coordinator restart preserves pending offer without duplicate notification', async () => {
    const c = await customer(),
      d = await driver(),
      r = await ride(c);
    expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
    const notify = vi.fn(),
      first = new RideDispatchService(repo, new MatchingService(drivers), notify);
    controllers.push(first);
    const pending = first.dispatch(r);
    await vi.waitFor(() => expect(rideEvents.listenerCount('ride:accepted')).toBeGreaterThan(0));
    first.dispose();
    await pending;
    const second = new RideDispatchService(repo, new MatchingService(drivers), notify);
    controllers.push(second);
    const start = performance.now();
    await second.recover();
    await vi.waitFor(() => expect(rideEvents.listenerCount('ride:accepted')).toBeGreaterThan(0));
    expect(notify).not.toHaveBeenCalled();
    await service.acceptRide(d.profileId, r.id);
    record('HD-RECOVERY', {
      notifications: notify.mock.calls.length,
      recoveryObservedMs: performance.now() - start,
    });
  });
  it('CITY-RADIUS-LIFECYCLE: matching, offer and acceptance enforce the same exact city radius', async () => {
    const areas = new PremiumCityAreas('config/service-area/premium-city-radius.json');
    const radiusRepo = new PostgresRideRepository(pool, areas),
      d = await driver('premium'),
      r = await ride(await customer(), 'premium');
    await pool.query(
      'UPDATE rides SET pickup_location=ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography WHERE id=$1',
      [r.id],
    );
    const actual = (await radiusRepo.findById(r.id))!,
      city = await areas.resolve(actual.pickup);
    for (const delta of [-0.01, 0, 0.01]) {
      await pool.query(
        'UPDATE driver_profiles SET last_location=ST_Project(ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography,$2::float8,0),last_location_at=$3 WHERE id=$1',
        [d.profileId, 25000 + delta, new Date(Date.now() - 1000)],
      );
      const candidates = await new MatchingService(
        drivers,
        undefined,
        undefined,
        areas,
      ).findDispatchDrivers(actual, null);
      expect(candidates.some((candidate) => candidate.driverProfileId === d.profileId)).toBe(
        delta <= 0,
      );
    }
    expect(await radiusRepo.offerDispatch(r.id, d.profileId, 1, city)).toBe(false);
    await vi.waitFor(async () =>
      expect(
        await drivers.updateLocation(d.profileId, {
          latitude: 25.6,
          longitude: 85.1,
          recordedAt: new Date(),
        }),
      ).toBe(true),
    );
    expect(await radiusRepo.offerDispatch(r.id, d.profileId, 1, city)).toBe(true);
    await pool.query(
      'UPDATE driver_profiles SET last_location=ST_Project(ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography,25001::float8,0) WHERE id=$1',
      [d.profileId],
    );
    await expect(
      new RideService(radiusRepo, drivers).acceptRide(d.profileId, r.id),
    ).rejects.toMatchObject({ statusCode: 409 });
    await vi.waitFor(async () =>
      expect(
        await drivers.updateLocation(d.profileId, {
          latitude: 25.6,
          longitude: 85.1,
          recordedAt: new Date(),
        }),
      ).toBe(true),
    );
    await new RideService(radiusRepo, drivers).acceptRide(d.profileId, r.id);
    expect((await radiusRepo.findById(r.id))?.assignedDriverId).toBe(d.profileId);
    record('CITY-RADIUS-LIFECYCLE', {
      city: 'patna',
      radiusMeters: 25000,
      offerOutside: false,
      acceptOutside: 409,
      assignmentInside: true,
    });
  });
  it('CITY-RADIUS-PENDING: leaving city coverage releases the pending offer for the next eligible driver', async () => {
    const areas = new PremiumCityAreas('config/service-area/premium-city-radius.json'),
      radiusRepo = new PostgresRideRepository(pool, areas),
      r = await ride(await customer(), 'premium'),
      d = await driver('premium'),
      next = await driver('premium');
    await pool.query(
      'UPDATE rides SET pickup_location=ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography WHERE id=$1',
      [r.id],
    );
    await pool.query(
      'UPDATE driver_profiles SET last_location=ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography WHERE id=ANY($1::uuid[])',
      [[d.profileId, next.profileId]],
    );
    const city = await areas.resolve({ latitude: 25.6, longitude: 85.1 });
    expect(await radiusRepo.offerDispatch(r.id, d.profileId, 1, city)).toBe(true);
    await pool.query(
      'UPDATE driver_profiles SET last_location=ST_Project(last_location,25001::float8,0) WHERE id=$1',
      [d.profileId],
    );
    expect(await radiusRepo.pendingDispatch(r.id)).toBeNull();
    expect(await radiusRepo.offerDispatch(r.id, next.profileId, 1, city)).toBe(true);
    await new RideService(radiusRepo, drivers).acceptRide(next.profileId, r.id);
    const states = await pool.query(
      'SELECT status FROM ride_dispatch_attempts WHERE ride_id=$1 ORDER BY attempt',
      [r.id],
    );
    expect(states.rows.map((row) => row.status)).toEqual(['rejected', 'accepted']);
    record('CITY-RADIUS-PENDING', {
      outsideReleased: true,
      nextAssigned: true,
      states: states.rows,
    });
  });
  it('OPS-SOCKET-SESSIONS: private offer reaches both driver sessions without assigning the ride', async () => {
    const d = await driver(),
      other = await driver(),
      r = await ride(await customer());
    expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
    const http = createServer(),
      io = createSocketServer(http, {
        driverService: new DriverService(drivers, undefined, repo),
        rideRepository: repo,
        rideService: service,
        routeRecalculationService: {} as never,
      });
    const sockets: Socket[] = [];
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address() as { port: number };
    const open = async (userId: string) => {
      const token = await signAccessToken({ sub: userId, role: 'driver', type: 'access' });
      const socket = connect(`http://127.0.0.1:${address.port}`, {
        autoConnect: false,
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      const ready = new Promise<void>((resolve, reject) => {
        socket.once('driver:ready', () => resolve());
        socket.once('connect_error', reject);
      });
      socket.connect();
      await ready;
      return socket;
    };
    try {
      const first = await open(d.userId),
        second = await open(d.userId),
        outsider = await open(other.userId);
      const leaked = vi.fn();
      outsider.on('ride:incoming', leaked);
      const received = [first, second].map(
        (socket) => new Promise<any>((resolve) => socket.once('ride:incoming', resolve)),
      );
      io.to(driverUserRoom(d.userId)).emit('ride:incoming', { rideId: r.id });
      expect(await Promise.all(received)).toEqual([{ rideId: r.id }, { rideId: r.id }]);
      expect((await repo.findById(r.id))?.assignedDriverId).toBeNull();
      first.disconnect();
      await vi.waitFor(() =>
        expect(io.sockets.adapter.rooms.get(driverUserRoom(d.userId))?.size).toBe(1),
      );
      expect(await drivers.getAvailability(d.profileId)).toBe('available');
      const result = await second.timeout(2000).emitWithAck('driver:accept', r.id);
      expect(result.success).toBe(true);
      expect((await repo.findById(r.id))?.assignedDriverId).toBe(d.profileId);
      expect(leaked).not.toHaveBeenCalled();
      record('OPS-SOCKET-SESSIONS', {
        sessions: 2,
        privateDeliveries: 2,
        outsiderDeliveries: 0,
        deliveryAssigned: false,
        authenticatedAcceptAssigned: true,
      });
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });
  it('OPS-WORKER-CRASH: an active BullMQ job survives a real worker-process termination', async () => {
    const r = await ride(await customer()),
      d = await driver();
    expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
    await expire(r.id);
    const name = `crash-${randomUUID()}`,
      connection = new Redis(process.env.DISPATCH_QA_REDIS_URL!, { maxRetriesPerRequest: 0 });
    const queue = new Queue(name, { connection });
    const child = fork(
      fileURLToPath(new URL('./dispatch-queue-crash.fixture.ts', import.meta.url)),
      [name],
      {
        execArgv: ['--import', 'tsx'],
        env: process.env,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    const message = (state: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.off('message', onMessage);
          reject(Error('QA worker did not reach ' + state));
        }, 10000);
        const onMessage = (value: any) => {
          if (value.state === state) {
            clearTimeout(timer);
            child.off('message', onMessage);
            resolve();
          }
        };
        child.on('message', onMessage);
      });
    let replacement: ReturnType<typeof startRideDispatchQueue> | undefined;
    try {
      await message('ready');
      const processing = message('processing');
      await queue.add(
        'expire',
        { rideId: r.id, driverProfileId: d.profileId, expiresAt: new Date().toISOString() },
        { jobId: 'owned-crash-job' },
      );
      await processing;
      expect(await (await queue.getJob('owned-crash-job'))?.getState()).toBe('active');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
      });
      const progress = { dispatch: vi.fn(async () => {}) },
        started = performance.now();
      replacement = startRideDispatchQueue(
        process.env.DISPATCH_QA_REDIS_URL!,
        repo,
        progress,
        name,
      );
      // Keep production BullMQ lease/stalled defaults: no manual lock deletion.
      await vi.waitFor(() => expect(progress.dispatch).toHaveBeenCalledTimes(1), {
        timeout: 100000,
        interval: 100,
      });
      expect(
        (await pool.query('SELECT status FROM ride_dispatch_attempts WHERE ride_id=$1', [r.id]))
          .rows[0].status,
      ).toBe('timed_out');
      // The dispatch callback runs before BullMQ acknowledges job completion.
      await vi.waitFor(
        async () => {
          expect(await (await queue.getJob('owned-crash-job'))?.getState()).toBe('completed');
        },
        { timeout: 5000 },
      );
      record('OPS-WORKER-CRASH', {
        realProcessTermination: true,
        recoveredJobs: 1,
        progressions: 1,
        recoveryMs: performance.now() - started,
      });
    } finally {
      if (child.exitCode === null) child.kill();
      await replacement?.close();
      await queue.obliterate({ force: true });
      await queue.close();
      connection.disconnect();
    }
  }, 120000);
  it('OPS-PG-INTERRUPTION: terminated owned connection is replaced without losing a pending lease', async () => {
    const r = await ride(await customer()),
      d = await driver();
    expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
    const isolated = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    isolated.on('error', () => {});
    try {
      const client = await isolated.connect();
      const identity = await client.query(
        'SELECT pg_backend_pid() AS pid,current_database() AS db',
      );
      expect(identity.rows[0].db).toMatch(/^admin_master_test_[a-f0-9]{32}$/);
      const interrupted = client.query('SELECT pg_sleep(10)').catch((error) => error);
      await pool.query('SELECT pg_terminate_backend($1)', [identity.rows[0].pid]);
      expect((await interrupted).code).toBe('57P01');
      client.release(true);
      const replacement = new PostgresRideRepository(isolated, syntheticDispatchAreas);
      expect((await replacement.pendingDispatch(r.id))?.driverProfileId).toBe(d.profileId);
      await service.acceptRide(d.profileId, r.id);
      expect((await replacement.findById(r.id))?.assignedDriverId).toBe(d.profileId);
      record('OPS-PG-INTERRUPTION', { interruption: '57P01', reconnected: true, assignments: 1 });
    } finally {
      await isolated.end();
    }
  });
  it('OPS-REDIS-OUTAGE: real TCP disconnection reconnects while PostgreSQL dispatch remains authoritative', async () => {
    const target = new URL(process.env.DISPATCH_QA_REDIS_URL!);
    expect(target.hostname).toBe('127.0.0.1');
    let available = true;
    const sockets = new Set<ReturnType<typeof connectTcp>>();
    const proxy = createTcpServer((socket) => {
      if (!available) {
        socket.destroy();
        return;
      }
      const upstream = connectTcp(Number(target.port), target.hostname);
      sockets.add(socket);
      sockets.add(upstream);
      socket.on('error', () => {});
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => {
        sockets.delete(socket);
        upstream.destroy();
      });
      upstream.on('close', () => sockets.delete(upstream));
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address() as { port: number };
    const redis = new Redis(`redis://127.0.0.1:${address.port}`, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      commandTimeout: 300,
    });
    redis.on('error', () => {});
    const progress = { dispatch: vi.fn(async () => {}) };
    const worker = startRideDispatchQueue(
      `redis://127.0.0.1:${address.port}`,
      repo,
      progress,
      `outage-${randomUUID()}`,
    );
    try {
      await vi.waitFor(async () => expect(await redis.ping()).toBe('PONG'));
      const expiringRide = await ride(await customer()),
        expiringDriver = await driver();
      expect(await repo.offerDispatch(expiringRide.id, expiringDriver.profileId, 1)).toBe(true);
      await vi.waitFor(() =>
        worker.schedule(expiringRide.id, expiringDriver.profileId, new Date(Date.now() + 500)),
      );
      available = false;
      for (const socket of sockets) socket.destroy();
      await vi.waitFor(() => expect(redis.status).not.toBe('ready'));
      await expect(redis.ping()).rejects.toThrow();
      const r = await ride(await customer()),
        d = await driver();
      expect(await repo.offerDispatch(r.id, d.profileId, 1)).toBe(true);
      await service.acceptRide(d.profileId, r.id);
      await expire(expiringRide.id);
      await expect(
        worker.schedule(r.id, d.profileId, new Date(Date.now() + 500)),
      ).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 700));
      available = true;
      await vi.waitFor(async () => expect(await redis.ping()).toBe('PONG'), { timeout: 5000 });
      // BullMQ uses a 15s run-loop retry and 30s lock/stalled intervals. A real
      // dropped worker connection may need lock recovery after Redis itself is ready.
      await vi.waitFor(() => expect(progress.dispatch).toHaveBeenCalledTimes(1), {
        timeout: 75000,
        interval: 100,
      });
      const history = await pool.query(
        'SELECT status FROM ride_dispatch_attempts WHERE ride_id=$1',
        [expiringRide.id],
      );
      expect(history.rows[0].status).toBe('timed_out');
      expect((await repo.findById(r.id))?.assignedDriverId).toBe(d.profileId);
      record('OPS-REDIS-OUTAGE', {
        transportInterrupted: true,
        redisRecovered: true,
        assignmentsDuringOutage: 1,
        recoveredDeadlineJobs: 1,
      });
    } finally {
      available = true;
      await worker.close();
      redis.disconnect();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }, 90000);
  it('OPS-SOAK: twenty pending premium offers survive sixty seconds with resource sampling', async () => {
    const pending = [],
      ds = [],
      rs = [];
    for (let i = 0; i < 20; i++) {
      const d = await driver('premium', 'sedan'),
        r = await ride(await customer(), 'premium', 'sedan');
      ds.push(d);
      rs.push(r);
      expect(await repo.offerDispatch(r.id, d.profileId, 1, syntheticDispatchCity)).toBe(true);
    }
    const spy = vi.spyOn(repo, 'pendingDispatch');
    const controller = new RideDispatchService(repo, new MatchingService(drivers), vi.fn());
    controllers.push(controller);
    const connection = new Redis(process.env.DISPATCH_QA_REDIS_URL!, { maxRetriesPerRequest: 0 });
    const queueName = `soak-${randomUUID()}`,
      inspection = new Queue(queueName, { connection });
    const worker = startRideDispatchQueue(
      process.env.DISPATCH_QA_REDIS_URL!,
      repo,
      controller,
      queueName,
    );
    queueCleanups.push(async () => {
      await worker.close();
      await inspection.obliterate({ force: true });
      await inspection.close();
      connection.disconnect();
    });
    controller.setDeadlineScheduler(worker.schedule);
    const start = performance.now(),
      memoryStart = process.memoryUsage().rss;
    for (const r of rs) pending.push(controller.dispatch(r));
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      // Exercise normal driver heartbeats; do not extend the stale-location policy.
      for (const d of ds)
        expect(
          await drivers.updateLocation(d.profileId, {
            latitude: 13,
            longitude: 77.5,
            recordedAt: new Date(),
          }),
        ).toBe(true);
      const memory = await connection.info('memory');
      const db = await pool.query(
        'SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname=current_database()',
      );
      samples.push({
        elapsedMs: performance.now() - start,
        rssBytes: process.memoryUsage().rss,
        poolTotal: pool.totalCount,
        poolWaiting: pool.waitingCount,
        dbConnections: db.rows[0].connections,
        redisUsedMemoryBytes: Number(memory.match(/^used_memory:(\d+)/m)?.[1]),
        jobs: await inspection.getJobCounts('active', 'delayed', 'waiting', 'failed', 'completed'),
      });
    }
    const pollCalls = spy.mock.calls.length;
    for (let i = 0; i < rs.length; i++) await service.acceptRide(ds[i]!.profileId, rs[i]!.id);
    await Promise.all(pending);
    const rows = await pool.query(
      "SELECT count(*)::int AS n,count(DISTINCT assigned_driver_id)::int AS drivers FROM rides WHERE id=ANY($1::uuid[]) AND status='driver_assigned'",
      [rs.map((r) => r.id)],
    );
    expect(rows.rows[0]).toEqual({ n: 20, drivers: 20 });
    expect(pollCalls).toBeGreaterThanOrEqual(1100);
    expect(samples.every((sample) => sample.jobs.failed === 0)).toBe(true);
    record('OPS-SOAK', {
      durationMs: performance.now() - start,
      pending: 20,
      pollCalls,
      pollsPerPendingSecond: pollCalls / 20 / ((performance.now() - start) / 1000),
      assignments: 20,
      memoryStartBytes: memoryStart,
      memoryEndBytes: process.memoryUsage().rss,
      poolTotal: pool.totalCount,
      poolWaiting: pool.waitingCount,
      samples,
    });
    spy.mockRestore();
  }, 100000);
});
