import { createServer, type Server as HttpServer } from 'node:http';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSocketServer } from '../socket.server.js';
import { rideRoom } from '../socket.rooms.js';
import { verifyAccessToken } from '../../../modules/auth/utils/jwt.js';
import type { RideRepository } from '../../../modules/rides/repositories/ride.repository.js';

vi.mock('../../../modules/auth/utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

describe('ride Socket.IO reconnect integration', () => {
  let httpServer: HttpServer | undefined;
  let socketServer: ReturnType<typeof createSocketServer> | undefined;
  let client: ClientSocket | undefined;

  afterEach(async () => {
    client?.disconnect();
    socketServer?.close();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    }
    client = undefined;
    socketServer = undefined;
    httpServer = undefined;
    vi.clearAllMocks();
  });

  it('re-authenticates, restores only authorized rooms, and avoids duplicates', async () => {
    const authorizedUser = 'customer-a';
    const rideId = '11111111-1111-4111-8111-111111111111';
    const otherRideId = '22222222-2222-4222-8222-222222222222';
    vi.mocked(verifyAccessToken).mockImplementation(async (token) => ({
      sub: token === 'customer-a-token' ? authorizedUser : 'customer-b',
      role: 'customer',
      type: 'access',
    }));
    const rideRepository = {
      isParticipant: vi.fn(
        async (candidateRide: string, userId: string) =>
          candidateRide === rideId && userId === authorizedUser,
      ),
      isAssignedDriver: vi.fn().mockResolvedValue(false),
    };
    const dependencies = {
      routeRecalculationService: {
        provider: {} as never,
        clock: Date.now,
        shouldRecalculate: () => false,
        calculate: async () => null,
      } as never,
      rideRepository: rideRepository as unknown as RideRepository,
      driverService: {} as never,
      rideService: {} as never,
    };
    httpServer = createServer();
    socketServer = createSocketServer(httpServer, dependencies);
    await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', () => resolve()));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Socket server did not start');
    client = createClient(`http://127.0.0.1:${address.port}`, {
      auth: { token: 'customer-a-token' },
      transports: ['websocket'],
      reconnection: false,
    });
    await onceConnected(client);

    expect(await emitAck(client, 'ride:join', rideId)).toMatchObject({ success: true });
    expect(await emitAck(client, 'ride:join', rideId)).toMatchObject({ success: true });
    expect(socketServer.sockets.adapter.rooms.get(rideRoom(rideId))?.size).toBe(1);

    let eventCount = 0;
    client.on('integration:event', () => {
      eventCount += 1;
    });
    socketServer.to(rideRoom(rideId)).emit('integration:event');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(eventCount).toBe(1);

    client.disconnect();
    await waitFor(() => !socketServer!.sockets.adapter.rooms.has(rideRoom(rideId)));
    client.auth = { token: 'customer-a-token' };
    const reconnect = onceConnected(client);
    client.connect();
    await reconnect;
    expect(socketServer.sockets.adapter.rooms.has(rideRoom(rideId))).toBe(false);
    expect(await emitAck(client, 'ride:join', otherRideId)).toMatchObject({
      success: false,
      error: { code: 'RIDE_ROOM_FORBIDDEN' },
    });
    expect(await emitAck(client, 'ride:join', rideId)).toMatchObject({ success: true });
    expect(socketServer.sockets.adapter.rooms.get(rideRoom(rideId))?.size).toBe(1);

    client.disconnect();
    const unauthorizedReconnect = onceConnected(client);
    client.auth = { token: 'customer-b-token' };
    client.connect();
    await unauthorizedReconnect;
    expect(await emitAck(client, 'ride:join', rideId)).toMatchObject({
      success: false,
      error: { code: 'RIDE_ROOM_FORBIDDEN' },
    });
    expect(socketServer.sockets.adapter.rooms.has(rideRoom(rideId))).toBe(false);
  });
});

function onceConnected(client: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
  });
}

function emitAck(client: ClientSocket, event: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve) => client.emit(event, payload, resolve));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}