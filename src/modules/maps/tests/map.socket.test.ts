import { createServer } from 'node:http';
import { io as connect, type Socket } from 'socket.io-client';
import { describe, expect, it, vi } from 'vitest';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import { DriverService } from '../../rides/services/driver.service.js';
import { RouteRecalculationService } from '../../rides/services/route-recalculation.service.js';
import type { DriverRepository } from '../../rides/repositories/driver.repository.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import type { RideService } from '../../rides/services/ride.service.js';
import { rideEvents } from '../../rides/events/ride.events.js';
vi.mock('../../auth/utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(async () => ({ sub: 'map-driver', role: 'driver', type: 'access' })),
}));
const ack = (client: Socket, event: string, payload: unknown) =>
  new Promise<{ success: boolean }>((resolve) => client.emit(event, payload, resolve));
describe('live GPS backend Socket.IO integration', () => {
  it('broadcasts HTTP/shared ingestion and five-second updates without requesting a route on every update', async () => {
    const now = Date.now(),
      rideId = '11111111-1111-4111-8111-111111111111';
    const driverRepository = {
      findProfileIdByUserId: vi.fn(async () => 'profile'),
      updateLocation: vi.fn(async () => true),
      markStale: vi.fn(async () => true),
    };
    const driver = new DriverService(
      driverRepository as unknown as DriverRepository,
      () => new Date(now),
    );
    const ride = {
      id: rideId,
      assignedDriverId: 'profile',
      status: 'in_progress',
      sector: 'passenger',
      pickup: { latitude: 0, longitude: 0 },
      destination: { latitude: 0, longitude: 0.01 },
    };
    const metadata = {
      lastCalculatedAt: now,
      lastOrigin: ride.pickup,
      lastValidatedOrigin: ride.pickup,
      route: { distanceMeters: 1112, durationSeconds: 120, encodedPolyline: '???o}@' },
      segment: 'destination' as const,
      destination: ride.destination,
    };
    const repository = {
      findById: vi.fn(async () => ride),
      findActiveForDriver: vi.fn(async () => ride),
      isAssignedDriver: vi.fn(async () => true),
      isParticipant: vi.fn(async () => true),
      getRouteMetadata: vi.fn(async () => metadata),
      updateRouteMetadata: vi.fn(async () => true),
    };
    const provider = {
      calculateRoute: vi.fn(async () => null),
      calculateMatrix: async () => [],
      geocode: async () => null,
      places: async () => [],
    };
    const http = createServer(),
      server = createSocketServer(http, {
        driverService: driver,
        rideRepository: repository as unknown as RideRepository,
        rideService: {} as RideService,
        routeRecalculationService: new RouteRecalculationService(provider, () => now),
      });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const client = connect(`http://127.0.0.1:${address.port}`, {
      auth: { token: 'fixture' },
      transports: ['websocket'],
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });
      expect(await ack(client, 'ride:join', rideId)).toMatchObject({ success: true });
      const events: unknown[] = [];
      client.on('ride:driver_location_updated', (e) => events.push(e));
      let finishSlowLookup!: (value: typeof ride) => void;
      repository.findActiveForDriver.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSlowLookup = resolve;
          }),
      );
      rideEvents.emit('driver:location_updated', {
        profileId: 'profile',
        userId: 'map-driver',
        location: { latitude: 0, longitude: 0.000001, timestamp: new Date(now - 25000) },
      });
      rideEvents.emit('driver:location_updated', {
        profileId: 'profile',
        userId: 'map-driver',
        location: { latitude: 0, longitude: 0.000002, timestamp: new Date(now - 20000) },
      });
      await vi.waitFor(() => expect(events).toHaveLength(1));
      finishSlowLookup(ride);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toHaveLength(1); // the delayed older lookup cannot regress the room location
      expect(events[0]).toMatchObject({ location: { longitude: 0.000002 } });
      events.length = 0;
      const slow: Array<(value: typeof ride) => void> = [];
      const callsBeforeBurst = repository.findActiveForDriver.mock.calls.length;
      for (let i = 0; i < 2; i++)
        repository.findActiveForDriver.mockImplementationOnce(
          () => new Promise((resolve) => slow.push(resolve)),
        );
      for (let i = 0; i < 100; i++)
        rideEvents.emit('driver:location_updated', {
          profileId: 'profile',
          userId: 'map-driver',
          location: {
            latitude: 0,
            longitude: 0.000002 + i * 0.00000001,
            timestamp: new Date(now - 19000 + i * 10),
          },
        });
      expect(repository.findActiveForDriver.mock.calls.length - callsBeforeBurst).toBe(2);
      slow.forEach((resolve) => resolve(ride));
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toMatchObject({ location: { longitude: 0.00000299 } });
      expect(repository.findActiveForDriver.mock.calls.length - callsBeforeBurst).toBe(3);
      rideEvents.emit('driver:location_updated', {
        profileId: 'profile',
        userId: 'map-driver',
        location: { latitude: 0, longitude: 0, timestamp: new Date(now - 19500) },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toHaveLength(1); // completed work also keeps a fresh watermark
      events.length = 0;
      for (let i = 0; i < 3; i++)
        expect(
          await ack(client, 'driver:location', {
            rideId,
            latitude: 0,
            longitude: 0.00001 * (i + 1),
            timestamp: new Date(now - 15000 + i * 5000).toISOString(),
          }),
        ).toMatchObject({ success: true });
      // Same ingestion service is called by the existing authenticated HTTP controller.
      await driver.updateLocation('map-driver', {
        latitude: 0,
        longitude: 0.00004,
        timestamp: new Date(now),
      });
      await vi.waitFor(() => expect(events).toHaveLength(4));
      expect(provider.calculateRoute).not.toHaveBeenCalled();
      expect(driverRepository.updateLocation).toHaveBeenCalledTimes(4);
      expect(
        await ack(client, 'driver:location', {
          rideId,
          latitude: 91,
          longitude: 0,
          timestamp: new Date(now).toISOString(),
        }),
      ).toMatchObject({ success: false });
      expect(driverRepository.updateLocation).toHaveBeenCalledTimes(4);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    }
    expect(rideEvents.listenerCount('driver:location_updated')).toBe(0);
  });
});

it('publishes HTTP lifecycle navigation phases to authorized ride members only', async () => {
  const rideId = '11111111-1111-4111-8111-111111111111';
  const repository = { isParticipant: vi.fn(async (id: string) => id === rideId) };
  const http = createServer();
  const server = createSocketServer(http, {
    driverService: {} as DriverService,
    rideRepository: repository as unknown as RideRepository,
    rideService: {} as RideService,
    routeRecalculationService: new RouteRecalculationService({
      calculateRoute: async () => null,
      calculateMatrix: async () => [],
      geocode: async () => null,
      places: async () => [],
    }),
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No socket address');
  const options = {
    auth: { token: 'fixture', sector: 'passenger' },
    transports: ['websocket'],
    reconnection: false,
  };
  const member = connect(`http://127.0.0.1:${address.port}`, options);
  const nonmember = connect(`http://127.0.0.1:${address.port}`, options);
  try {
    await Promise.all(
      [member, nonmember].map(
        (client) =>
          new Promise<void>((resolve, reject) => {
            client.once('connect', resolve);
            client.once('connect_error', reject);
          }),
      ),
    );
    expect(await ack(member, 'ride:join', rideId)).toMatchObject({ success: true });
    expect(await ack(nonmember, 'ride:join', '22222222-2222-4222-8222-222222222222')).toMatchObject(
      { success: false },
    );
    const events: Array<{ segment: string | null; navigationTarget: unknown }> = [];
    const unrelated: unknown[] = [];
    member.on('ride:lifecycle_updated', (event) => events.push(event));
    nonmember.on('ride:lifecycle_updated', (event) => unrelated.push(event));
    const pickup = { latitude: 25.59, longitude: 85.13 },
      destination = { latitude: 25.62, longitude: 85.04 };
    for (const status of ['driver_arriving', 'driver_arrived', 'in_progress', 'completed']) {
      rideEvents.emit('ride:lifecycle_updated', { id: rideId, status, pickup, destination });
    }
    await vi.waitFor(() => expect(events).toHaveLength(4));
    expect(events.map((event) => event.segment)).toEqual(['pickup', 'pickup', 'destination', null]);
    expect(events.map((event) => event.navigationTarget)).toEqual([
      pickup,
      pickup,
      destination,
      null,
    ]);
    expect(unrelated).toHaveLength(0);
  } finally {
    member.disconnect();
    nonmember.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
  }
  expect(rideEvents.listenerCount('ride:lifecycle_updated')).toBe(0);
});
