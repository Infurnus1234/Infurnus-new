import { createServer, type Server as HttpServer } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSocketServer } from '../socket.server.js';
import { verifyAccessToken } from '../../../modules/auth/utils/jwt.js';
import { rideEvents } from '../../../modules/rides/events/ride.events.js';
import type { RideSocketDependencies } from '../socket.server.js';
import type { Ride } from '../../../modules/rides/types/ride.js';

vi.mock('../../../modules/auth/utils/jwt.js', () => ({ verifyAccessToken: vi.fn() }));
describe('Driver audit Socket.IO security parity', () => {
  let server: HttpServer, sockets: ReturnType<typeof createSocketServer>;
  const clients: Socket[] = [];
  afterEach(async () => {
    for (const client of clients) client.disconnect();
    clients.length = 0;
    sockets?.close();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    server = undefined!;
    sockets = undefined!;
    vi.clearAllMocks();
  });
  const ride = {
    id: 'fixture-ride',
    customerId: 'customer',
    assignedDriverId: 'profile',
    status: 'completed',
    pickup: { latitude: 12, longitude: 77 },
    destination: { latitude: 13, longitude: 78 },
    fareEstimate: 300,
    finalFare: 320,
    pin: '7391',
    actualFuelCost: 30,
    billing: { private: 'billing' },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Ride;
  async function connect(
    role: 'driver_fleet_owner' | 'customer',
    mode?: string,
    authorizeAccount?: RideSocketDependencies['authorizeAccount'],
  ) {
    vi.mocked(verifyAccessToken).mockImplementation(async (token) => ({
      sub: token,
      role: token === 'customer' ? 'customer' : 'driver_fleet_owner',
      type: 'access',
    }));
    if (!server) {
      server = createServer();
      sockets = createSocketServer(server, {
        driverService: { profileForUser: vi.fn().mockResolvedValue('profile') } as never,
        rideService: {
          acceptRide: vi.fn().mockResolvedValue(ride),
          transitionRide: vi.fn().mockResolvedValue(ride),
        } as never,
        rideRepository: { isParticipant: vi.fn().mockResolvedValue(true) } as never,
        routeRecalculationService: { clear: vi.fn() } as never,
        ...(authorizeAccount ? { authorizeAccount } : {}),
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server did not start');
    const client = io(`http://127.0.0.1:${address.port}`, {
      auth: { token: role === 'customer' ? 'customer' : 'combined', providerMode: mode },
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    return client;
  }
  const ack = (client: Socket, event: string, payload: unknown) =>
    client.timeout(2000).emitWithAck(event, payload);
  it('combined Driver-mode acceptance/status acknowledgements never expose PIN or legacy billing fields', async () => {
    const client = await connect('driver_fleet_owner', 'driver');
    for (const [event, payload] of [
      ['driver:accept', 'fixture-ride'],
      ['ride:status', { rideId: 'fixture-ride', status: 'completed' }],
    ] as const) {
      const response = await ack(client, event, payload);
      expect(response.success).toBe(true);
      expect(response.data.pin).toBeUndefined();
      expect(response.data.billing).toBeUndefined();
      expect(response.data.finalFare).toBeUndefined();
      expect(response.data.rideInformation.fare.amount).toBe(320);
    }
  });
  it('combined Fleet-mode cannot invoke Driver realtime actions', async () => {
    const client = await connect('driver_fleet_owner', 'fleet_owner');
    expect((await ack(client, 'driver:accept', 'fixture-ride')).success).toBe(false);
  });
  it('revoked accounts are rechecked before a packet and disconnected from private rooms', async () => {
    let active = true;
    const authorize = vi.fn(async () => {
      if (!active) throw new Error('Suspended');
    });
    const client = await connect('driver_fleet_owner', 'driver', authorize);
    expect((await ack(client, 'ride:join', 'fixture-ride')).success).toBe(true);
    active = false;
    const response = await ack(client, 'driver:accept', 'fixture-ride');
    expect(response).toMatchObject({ success: false, error: { code: 'AUTHENTICATION_REQUIRED' } });
    await new Promise<void>((resolve) => {
      if (!client.connected) resolve();
      else client.once('disconnect', () => resolve());
    });
    expect(client.connected).toBe(false);
  });
  it('shared room lifecycle preserves the customer payload while sanitizing the Driver payload', async () => {
    const driver = await connect('driver_fleet_owner', 'driver'),
      customer = await connect('customer');
    await ack(driver, 'ride:join', 'fixture-ride');
    await ack(customer, 'ride:join', 'fixture-ride');
    const driverEvent = new Promise<any>((resolve) =>
      driver.once('ride:lifecycle_updated', resolve),
    );
    const customerEvent = new Promise<any>((resolve) =>
      customer.once('ride:lifecycle_updated', resolve),
    );
    rideEvents.emit('ride:lifecycle_updated', ride);
    const [driverPayload, customerPayload] = await Promise.all([driverEvent, customerEvent]);
    expect(driverPayload.ride.pin).toBeUndefined();
    expect(driverPayload.ride.billing).toBeUndefined();
    expect(customerPayload.ride.pin).toBe('7391');
    expect(customerPayload.ride.finalFare).toBe(320);
  });
});
