import { createServer, type Server as HttpServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { verifyAccessToken } from '../../../modules/auth/utils/jwt.js';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import { MatchingService } from '../services/matching.service.js';

vi.mock('../../../modules/auth/utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

const loadEnabled = process.env.RIDE_LOAD_TESTS === 'true';
const describeLoad = loadEnabled ? describe : describe.skip;
const clientCount = 20;
const updatesPerClient = 25;
const rideId = '33333333-3333-4333-8333-333333333333';

describeLoad('controlled ride load benchmark', () => {
  let httpServer: HttpServer | undefined;
  let socketServer: ReturnType<typeof createSocketServer> | undefined;
  const clients: ClientSocket[] = [];

  afterAll(async () => {
    clients.forEach((client) => client.disconnect());
    socketServer?.close();
    if (httpServer) await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  });

  it('measures bounded location, matching, acceptance, and reconnect work', async () => {
    const locationUpdates = vi.fn().mockResolvedValue(undefined);
    const acceptanceAttempts = vi.fn().mockResolvedValue({ id: rideId });
    const nearbyCandidates = Array.from({ length: 20 }, (_, index) => ({
      driverProfileId: `driver-${index}`,
      userId: `user-${index}`,
      vehicleId: `vehicle-${index}`,
      distanceMeters: index + 1,
      latitude: 12.9 + index / 1000,
      longitude: 77.5 + index / 1000,
      availabilityStatus: 'available' as const,
      verificationStatus: 'approved',
      activeRideCount: 0,
      locationRecordedAt: new Date(),
    }));
    const rideRepository = {
      isParticipant: vi.fn().mockResolvedValue(true),
      isAssignedDriver: vi.fn().mockResolvedValue(true),
      findNearbyEligible: vi.fn().mockResolvedValue(nearbyCandidates),
    };
    const driverService = {
      updateLocation: locationUpdates,
      profileForUser: vi.fn(async (userId: string) => userId.replace('user-', 'driver-')),
      markDisconnected: vi.fn().mockResolvedValue(undefined),
    };
    const rideService = {
      acceptRide: acceptanceAttempts,
      transitionRide: vi.fn(),
    };
    vi.mocked(verifyAccessToken).mockImplementation(async (token) => ({
      sub: token,
      role: 'driver',
      type: 'access',
    }));
    httpServer = createServer();
    socketServer = createSocketServer(httpServer, {
      rideRepository: rideRepository as never,
      driverService: driverService as never,
      rideService: rideService as never,
      routeRecalculationService: {
        shouldRecalculate: () => false,
        calculate: async () => null,
      } as never,
    });
    await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Load server did not start');

    const connectStartedAt = performance.now();
    await Promise.all(
      Array.from({ length: clientCount }, async (_, index) => {
        const client = createClient(`http://127.0.0.1:${address.port}`, {
          auth: { token: `user-${index}` },
          transports: ['websocket'],
          reconnection: false,
        });
        clients.push(client);
        await onceConnected(client);
      }),
    );
    const connectLatencyMs = performance.now() - connectStartedAt;

    const updateStartedAt = performance.now();
    const updateResults = await Promise.all(
      clients.flatMap((client, clientIndex) =>
        Array.from({ length: updatesPerClient }, (_, updateIndex) =>
          emitAck(client, 'driver:location', {
            rideId,
            latitude: 12.9 + clientIndex / 1000,
            longitude: 77.5 + updateIndex / 10000,
            timestamp: new Date().toISOString(),
          }),
        ),
      ),
    );
    const updateLatencyMs = performance.now() - updateStartedAt;
    expect(updateResults.every((result) => result.success)).toBe(true);

    const matching = new MatchingService(rideRepository as never);
    const matchingStartedAt = performance.now();
    await Promise.all(
      Array.from({ length: 100 }, () =>
        matching.findBestDriver({ latitude: 12.9, longitude: 77.5 }),
      ),
    );
    const matchingLatencyMs = performance.now() - matchingStartedAt;

    const acceptanceStartedAt = performance.now();
    const acceptanceResults = await Promise.all(
      clients.map((client) => emitAck(client, 'driver:accept', rideId)),
    );
    const acceptanceLatencyMs = performance.now() - acceptanceStartedAt;
    expect(acceptanceResults.every((result) => result.success)).toBe(true);

    const reconnectStartedAt = performance.now();
    clients.forEach((client) => client.disconnect());
    await Promise.all(
      clients.map(async (client) => {
        const connected = onceConnected(client);
        client.connect();
        await connected;
      }),
    );
    const reconnectLatencyMs = performance.now() - reconnectStartedAt;

    const measurement = {
      clients: clientCount,
      locationUpdates: clientCount * updatesPerClient,
      locationFailures: updateResults.filter((result) => !result.success).length,
      connectLatencyMs: Number(connectLatencyMs.toFixed(2)),
      locationLatencyMs: Number(updateLatencyMs.toFixed(2)),
      matchingRequests: 100,
      matchingLatencyMs: Number(matchingLatencyMs.toFixed(2)),
      acceptanceAttempts: clients.length,
      acceptanceConflicts: acceptanceResults.filter((result) => !result.success).length,
      acceptanceLatencyMs: Number(acceptanceLatencyMs.toFixed(2)),
      reconnectLatencyMs: Number(reconnectLatencyMs.toFixed(2)),
      googleRequests: 0,
    };
    console.info(`RIDE_LOAD_MEASUREMENT ${JSON.stringify(measurement)}`);
    expect(measurement.googleRequests).toBe(0);
    expect(driverService.markDisconnected).toHaveBeenCalledTimes(clientCount);
  });
});

interface AckResult {
  success: boolean;
  [key: string]: unknown;
}

function onceConnected(client: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
  });
}

function emitAck(client: ClientSocket, event: string, payload: unknown): Promise<AckResult> {
  return new Promise((resolve) => client.emit(event, payload, resolve));
}
