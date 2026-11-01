import { createServer } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import { describe, expect, it, vi } from 'vitest';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import { DriverService } from '../../rides/services/driver.service.js';
import { RouteRecalculationService } from '../../rides/services/route-recalculation.service.js';
import { rideEvents } from '../../rides/events/ride.events.js';
import type { RouteMetadata, RideRepository } from '../../rides/repositories/ride.repository.js';
import type { DriverRepository } from '../../rides/repositories/driver.repository.js';
import type { RideService } from '../../rides/services/ride.service.js';
import type { Ride } from '../../rides/types/ride.js';

vi.mock('../../auth/utils/jwt.js', () => ({
  verifyAccessToken: async (token: string) => ({
    sub: token,
    role: token === 'patna-driver' ? 'driver' : 'user',
    type: 'access',
  }),
}));
const ack = (client: Socket, name: string, payload: unknown) =>
  new Promise<{ success: boolean }>((resolve) => client.emit(name, payload, resolve));

describe('mocked Patna ride over real Socket.IO', () => {
  it('synchronizes participants through pickup, arrival, start, heading change, reconnect and completion', async () => {
    const now = Date.now();
    const ride = {
      id: 'patna-ride',
      assignedDriverId: 'patna-profile',
      status: 'driver_arriving',
      sector: 'passenger',
      pinVerified: false,
      pickup: { latitude: 25.6041, longitude: 85.1376 },
      destination: { latitude: 25.6141, longitude: 85.1476 },
    } as Ride;
    let latest: Record<string, unknown> | null = null;
    const locations = {
      findProfileIdByUserId: async () => 'patna-profile',
      updateLocation: vi.fn(async (_id, fix) => {
        latest = fix;
        return true;
      }),
      markStale: async () => true,
    };
    let metadata: RouteMetadata | null = null;
    const repository = {
      findById: async () => ride,
      findActiveForDriver: async () =>
        ['completed', 'cancelled'].includes(ride.status) ? null : ride,
      isAssignedDriver: async (_id: string, actor: string) => actor === 'patna-driver',
      isParticipant: async (_id: string, actor: string) =>
        ['patna-driver', 'patna-customer'].includes(actor),
      getRouteMetadata: async () => metadata,
      updateRouteMetadata: async (_id: string, value: RouteMetadata) => {
        metadata = value;
        return true;
      },
    };
    const route = vi.fn(async () => ({ distanceMeters: 1200, durationSeconds: 180 }));
    const http = createServer();
    const server = createSocketServer(http, {
      driverService: new DriverService(locations as unknown as DriverRepository),
      rideRepository: repository as unknown as RideRepository,
      rideService: {} as RideService,
      routeRecalculationService: new RouteRecalculationService({
        calculateRoute: route,
        calculateMatrix: async () => [],
        geocode: async () => null,
        places: async () => [],
      }),
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as { port: number }).port;
    const clients: Socket[] = [];
    const connect = async (token: string) => {
      const socket = io(`http://127.0.0.1:${port}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      clients.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return socket;
    };
    try {
      const driver = await connect('patna-driver');
      let customer = await connect('patna-customer');
      const stranger = await connect('stranger');
      expect(await ack(stranger, 'ride:join', ride.id)).toMatchObject({ success: false });
      for (const socket of [driver, customer])
        expect(await ack(socket, 'ride:join', ride.id)).toMatchObject({ success: true });
      const driverEvents: unknown[] = [],
        customerEvents: unknown[] = [],
        unrelated: unknown[] = [];
      driver.on('ride:driver_location_updated', (event) => driverEvents.push(event));
      customer.on('ride:driver_location_updated', (event) => customerEvents.push(event));
      stranger.on('ride:driver_location_updated', (event) => unrelated.push(event));
      for (let i = 0; i < 3; i++) {
        expect(
          await ack(driver, 'driver:location', {
            rideId: ride.id,
            latitude: 25.5941 + i * 0.00005,
            longitude: 85.1376,
            timestamp: new Date(now - 5000 + i * 1000).toISOString(),
            heading: i === 2 ? 90 : 0,
            speed: 5,
            accuracy: 5,
          }),
        ).toMatchObject({ success: true });
        await vi.waitFor(() => expect(customerEvents).toHaveLength(i + 1));
      }
      expect(customerEvents).toEqual(driverEvents);
      expect(customerEvents[2]).toMatchObject({ location: { heading: 90 } });
      expect(unrelated).toHaveLength(0);
      ride.status = 'driver_arrived';
      rideEvents.emit('ride:lifecycle_updated', ride);
      ride.status = 'in_progress';
      ride.pinVerified = true;
      rideEvents.emit('ride:lifecycle_updated', ride);
      customer.disconnect();
      customer = await connect('patna-customer');
      expect(await ack(customer, 'ride:join', ride.id)).toMatchObject({ success: true });
      // The accepted fix is retained by ingestion for the authenticated snapshot recovery path.
      expect(latest).toMatchObject({ latitude: 25.5942, heading: 90 });
      const recovered: unknown[] = [];
      customer.on('ride:driver_location_updated', (event) => recovered.push(event));
      expect(
        await ack(driver, 'driver:location', {
          rideId: ride.id,
          latitude: 25.59425,
          longitude: 85.13765,
          timestamp: new Date(now - 1000).toISOString(),
          heading: 45,
          speed: 5,
          accuracy: 5,
        }),
      ).toMatchObject({ success: true });
      await vi.waitFor(() => expect(recovered).toHaveLength(1));
      ride.status = 'completed';
      rideEvents.emit('ride:lifecycle_updated', ride);
      expect(
        await ack(driver, 'driver:location', {
          rideId: ride.id,
          latitude: 25.5943,
          longitude: 85.1377,
          timestamp: new Date(now).toISOString(),
        }),
      ).toMatchObject({ success: false });
      expect(locations.updateLocation).toHaveBeenCalledTimes(4);
      expect(route.mock.calls.length).toBeLessThanOrEqual(2);
      expect(unrelated).toHaveLength(0);
    } finally {
      clients.forEach((client) => client.disconnect());
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});
