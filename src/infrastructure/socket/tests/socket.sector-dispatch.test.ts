import { createServer, type Server as HttpServer } from 'node:http';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSocketServer } from '../socket.server.js';
import { verifyAccessToken } from '../../../modules/auth/utils/jwt.js';
import { rideEvents } from '../../../modules/rides/events/ride.events.js';
import type { Ride } from '../../../modules/rides/types/ride.js';

vi.mock('../../../modules/auth/utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

describe('Socket.IO Sector-Constrained Driver Dispatch', () => {
  let httpServer: HttpServer | undefined;
  let socketServer: ReturnType<typeof createSocketServer> | undefined;
  const clients: ClientSocket[] = [];

  afterEach(async () => {
    for (const client of clients) {
      client.disconnect();
    }
    clients.length = 0;
    socketServer?.close();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    }
    socketServer = undefined;
    httpServer = undefined;
    vi.clearAllMocks();
  });

  function makeRide(overrides: Partial<Ride> = {}): Ride {
    return {
      id: 'ride-1234',
      customerId: 'cust-1',
      assignedDriverId: null,
      assignedVehicleId: null,
      pickup: { latitude: 12.9716, longitude: 77.5946 },
      destination: { latitude: 12.9352, longitude: 77.6245 },
      pickupAddress: 'MG Road',
      destinationAddress: 'Koramangala',
      status: 'searching',
      sector: 'passenger',
      vehicleCategory: 'sedan',
      cancellationReason: null,
      cancelledAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('routes rides strictly to the matching sector and category drivers', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(async (token) => {
      const userId = token.replace(/-token$/, '');
      return {
        sub: userId,
        role: 'driver',
        type: 'access',
      };
    });

    const driverService = {
      getActiveVehicleForUser: vi.fn().mockImplementation(async (userId: string) => {
        if (userId === 'driver-passenger') return { sector: 'passenger', category: 'sedan' };
        if (userId === 'driver-logistics') return { sector: 'logistics', category: 'mini_truck' };
        if (userId === 'driver-service') return { sector: 'service', category: 'jcb' };
        if (userId === 'driver-premium') return { sector: 'premium', category: 'luxury' };
        return null;
      }),
      markDisconnected: vi.fn().mockResolvedValue(undefined),
      nearby: vi.fn().mockResolvedValue([]), // Force sector room fallback to test room isolation
    };

    const dependencies = {
      driverService: driverService as never,
      rideRepository: {} as never,
      rideService: {} as never,
      routeRecalculationService: {} as never,
    };

    httpServer = createServer();
    socketServer = createSocketServer(httpServer, dependencies);
    await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Failed to start test HTTP server');
    const port = address.port;

    const createDriverClient = async (userId: string) => {
      const client = createClient(`http://127.0.0.1:${port}`, {
        auth: { token: `${userId}-token` },
        transports: ['websocket'],
        reconnection: false,
      });
      clients.push(client);
      await new Promise<void>((resolve, reject) => {
        client.once('driver:ready', () => resolve());
        client.once('connect_error', reject);
      });
      return client;
    };

    const passengerClient = await createDriverClient('driver-passenger');
    const logisticsClient = await createDriverClient('driver-logistics');
    const serviceClient = await createDriverClient('driver-service');
    const premiumClient = await createDriverClient('driver-premium');

    const received = {
      passenger: [] as Ride[],
      logistics: [] as Ride[],
      service: [] as Ride[],
      premium: [] as Ride[],
    };

    passengerClient.on('ride:incoming', ({ ride }) => received.passenger.push(ride));
    logisticsClient.on('ride:incoming', ({ ride }) => received.logistics.push(ride));
    serviceClient.on('ride:incoming', ({ ride }) => received.service.push(ride));
    premiumClient.on('ride:incoming', ({ ride }) => received.premium.push(ride));

    // 1. Emit Passenger Ride
    const passengerRide = makeRide({
      id: 'ride-passenger-1',
      sector: 'passenger',
      vehicleCategory: 'sedan',
    });
    rideEvents.emit('ride:created', passengerRide);
    await new Promise((r) => setTimeout(r, 50));

    expect(received.passenger.map((r) => r.id)).toContain('ride-passenger-1');
    expect(received.logistics).toHaveLength(0);
    expect(received.service).toHaveLength(0);
    expect(received.premium).toHaveLength(0);

    // 2. Emit Logistics Ride
    const logisticsRide = makeRide({
      id: 'ride-logistics-1',
      sector: 'logistics',
      vehicleCategory: 'mini_truck',
    });
    rideEvents.emit('ride:created', logisticsRide);
    await new Promise((r) => setTimeout(r, 50));

    expect(received.passenger.map((r) => r.id)).not.toContain('ride-logistics-1');
    expect(received.logistics.map((r) => r.id)).toContain('ride-logistics-1');
    expect(received.service).toHaveLength(0);
    expect(received.premium).toHaveLength(0);

    // 3. Emit Service Ride (JCB)
    const serviceRide = makeRide({
      id: 'ride-service-1',
      sector: 'service',
      vehicleCategory: 'jcb',
    });
    rideEvents.emit('ride:created', serviceRide);
    await new Promise((r) => setTimeout(r, 50));

    expect(received.passenger.map((r) => r.id)).not.toContain('ride-service-1');
    expect(received.logistics.map((r) => r.id)).not.toContain('ride-service-1');
    expect(received.service.map((r) => r.id)).toContain('ride-service-1');
    expect(received.premium).toHaveLength(0);

    // 4. Emit Premium Ride
    const premiumRide = makeRide({
      id: 'ride-premium-1',
      sector: 'premium',
      vehicleCategory: 'luxury',
    });
    rideEvents.emit('ride:created', premiumRide);
    await new Promise((r) => setTimeout(r, 50));

    expect(received.passenger.map((r) => r.id)).not.toContain('ride-premium-1');
    expect(received.logistics.map((r) => r.id)).not.toContain('ride-premium-1');
    expect(received.service).not.toContain('ride-premium-1');
    expect(received.premium.map((r) => r.id)).toContain('ride-premium-1');
  });

  it('does not dispatch category-mismatched rides within the same sector', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(async (token) => {
      const userId = token.replace(/-token$/, '');
      return {
        sub: userId,
        role: 'driver',
        type: 'access',
      };
    });

    const driverService = {
      getActiveVehicleForUser: vi.fn().mockImplementation(async (userId: string) => {
        if (userId === 'driver-sedan') return { sector: 'passenger', category: 'sedan' };
        if (userId === 'driver-suv') return { sector: 'passenger', category: 'suv' };
        return null;
      }),
      markDisconnected: vi.fn().mockResolvedValue(undefined),
      nearby: vi.fn().mockResolvedValue([]),
    };

    const dependencies = {
      driverService: driverService as never,
      rideRepository: {} as never,
      rideService: {} as never,
      routeRecalculationService: {} as never,
    };

    httpServer = createServer();
    socketServer = createSocketServer(httpServer, dependencies);
    await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Failed to start test HTTP server');
    const port = address.port;

    const createDriverClient = async (userId: string) => {
      const client = createClient(`http://127.0.0.1:${port}`, {
        auth: { token: `${userId}-token` },
        transports: ['websocket'],
        reconnection: false,
      });
      clients.push(client);
      await new Promise<void>((resolve, reject) => {
        client.once('driver:ready', () => resolve());
        client.once('connect_error', reject);
      });
      return client;
    };

    const sedanDriver = await createDriverClient('driver-sedan');
    const suvDriver = await createDriverClient('driver-suv');

    let sedanReceived = false;
    let suvReceived = false;

    sedanDriver.on('ride:incoming', () => {
      sedanReceived = true;
    });
    suvDriver.on('ride:incoming', () => {
      suvReceived = true;
    });

    // Create SUV ride
    const suvRide = makeRide({
      id: 'ride-suv-only',
      sector: 'passenger',
      vehicleCategory: 'suv',
    });
    rideEvents.emit('ride:created', suvRide);
    await new Promise((r) => setTimeout(r, 50));

    expect(suvReceived).toBe(true);
    expect(sedanReceived).toBe(false);
  });
});
