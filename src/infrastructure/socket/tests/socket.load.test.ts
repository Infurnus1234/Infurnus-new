import { createServer, type Server as HttpServer } from 'node:http';

import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyAccessToken } from '../../../modules/auth/utils/jwt.js';
import { createSocketServer } from '../socket.server.js';

vi.mock('../../../modules/auth/utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

describe('Socket.IO load and stress verification', () => {
  let httpServer: HttpServer | undefined;
  let ioServer: ReturnType<typeof createSocketServer> | undefined;
  const clients: ClientSocket[] = [];

  afterEach(async () => {
    for (const client of clients) {
      client.removeAllListeners();
      client.disconnect();
    }

    clients.length = 0;

    ioServer?.close();
    ioServer = undefined;

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer?.close(() => resolve());
      });

      httpServer = undefined;
    }

    vi.clearAllMocks();
  });

  async function startServer(): Promise<number> {
    httpServer = createServer();
    ioServer = createSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer?.listen(0, '127.0.0.1', () => resolve());
    });

    const address = httpServer.address();

    if (!address || typeof address === 'string') {
      throw new Error('Failed to determine test server port');
    }

    return address.port;
  }

  function createClientConnection(port: number, token?: string): ClientSocket {
    const client =
      token === undefined
        ? createClient(`http://127.0.0.1:${port}`, {
            transports: ['websocket'],
            reconnection: false,
          })
        : createClient(`http://127.0.0.1:${port}`, {
            transports: ['websocket'],
            reconnection: false,
            auth: {
              token,
            },
          });

    clients.push(client);

    return client;
  }

  async function connectClient(port: number, token: string): Promise<ClientSocket> {
    const client = createClientConnection(port, token);

    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });

    return client;
  }

  async function rejectClient(port: number, token?: string): Promise<Error> {
    const client = createClientConnection(port, token);

    return new Promise<Error>((resolve, reject) => {
      client.once('connect_error', resolve);

      client.once('connect', () => {
        reject(new Error('Client unexpectedly connected'));
      });
    });
  }

  it('handles 50 concurrent authenticated connections', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(async (token: string) => ({
      sub: token,
      role: 'customer',
      type: 'access',
    }));

    const port = await startServer();

    const connectionCount = 50;
    const startedAt = performance.now();

    const connectedClients = await Promise.all(
      Array.from({ length: connectionCount }, (_, index) =>
        connectClient(port, `load-user-${index}`),
      ),
    );

    const durationMs = performance.now() - startedAt;

    expect(connectedClients).toHaveLength(connectionCount);
    expect(connectedClients.every((client) => client.connected)).toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledTimes(connectionCount);
    expect(ioServer?.engine.clientsCount).toBe(connectionCount);
    expect(durationMs).toBeLessThan(10_000);
  });

  it('handles 100 concurrent authenticated connections', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(async (token: string) => ({
      sub: token,
      role: 'customer',
      type: 'access',
    }));

    const port = await startServer();

    const connectionCount = 100;
    const startedAt = performance.now();

    const connectedClients = await Promise.all(
      Array.from({ length: connectionCount }, (_, index) =>
        connectClient(port, `stress-user-${index}`),
      ),
    );

    const durationMs = performance.now() - startedAt;

    expect(connectedClients).toHaveLength(connectionCount);
    expect(connectedClients.every((client) => client.connected)).toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledTimes(connectionCount);
    expect(ioServer?.engine.clientsCount).toBe(connectionCount);
    expect(durationMs).toBeLessThan(15_000);
  });

  it('rejects 50 concurrent unauthenticated connections', async () => {
    const port = await startServer();

    const connectionCount = 50;

    const errors = await Promise.all(
      Array.from({ length: connectionCount }, () => rejectClient(port)),
    );

    expect(errors).toHaveLength(connectionCount);
    expect(errors.every((error) => error.message === 'Authentication failed')).toBe(true);
    expect(verifyAccessToken).not.toHaveBeenCalled();

    await vi.waitFor(
      () => {
        expect(ioServer?.engine.clientsCount).toBe(0);
      },
      {
        timeout: 5_000,
      },
    );
  });

  it('rejects 50 concurrent invalid-token connections', async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(new Error('JWT verification failed'));

    const port = await startServer();

    const connectionCount = 50;

    const errors = await Promise.all(
      Array.from({ length: connectionCount }, (_, index) =>
        rejectClient(port, `invalid-token-${index}`),
      ),
    );

    expect(errors).toHaveLength(connectionCount);
    expect(errors.every((error) => error.message === 'Authentication failed')).toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledTimes(connectionCount);

    await vi.waitFor(
      () => {
        expect(ioServer?.engine.clientsCount).toBe(0);
      },
      {
        timeout: 5_000,
      },
    );
  });

  it('cleans up 50 authenticated connections after disconnect', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(async (token: string) => ({
      sub: token,
      role: 'customer',
      type: 'access',
    }));

    const port = await startServer();

    const connectionCount = 50;

    await Promise.all(
      Array.from({ length: connectionCount }, (_, index) =>
        connectClient(port, `cleanup-user-${index}`),
      ),
    );

    expect(ioServer?.engine.clientsCount).toBe(connectionCount);

    for (const client of clients) {
      client.disconnect();
    }

    await vi.waitFor(
      () => {
        expect(ioServer?.engine.clientsCount).toBe(0);
      },
      {
        timeout: 5_000,
      },
    );
  });

  it('re-authenticates successfully across 10 reconnect cycles', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(async (token: string) => ({
      sub: token,
      role: 'customer',
      type: 'access',
    }));

    const port = await startServer();

    const client = await connectClient(port, 'initial-token');

    const reconnectCount = 10;

    for (let index = 0; index < reconnectCount; index += 1) {
      client.disconnect();

      await vi.waitFor(() => {
        expect(client.connected).toBe(false);
      });

      client.auth = {
        token: `reconnect-token-${index}`,
      };

      const reconnectPromise = new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });

      client.connect();

      await reconnectPromise;

      expect(client.connected).toBe(true);
    }

    expect(verifyAccessToken).toHaveBeenCalledTimes(reconnectCount + 1);
  });

  it('keeps valid connections while rejecting invalid connections in a mixed burst', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(async (token: string) => {
      if (token.startsWith('valid-')) {
        return {
          sub: token,
          role: 'customer',
          type: 'access',
        };
      }

      throw new Error('Invalid token');
    });

    const port = await startServer();

    const validCount = 50;
    const invalidCount = 50;

    const startedAt = performance.now();

    const results = await Promise.all(
      Array.from({ length: validCount + invalidCount }, (_, index) => {
        if (index < validCount) {
          return connectClient(port, `valid-${index}`).then(() => true);
        }

        return rejectClient(port, `invalid-${index}`).then(() => false);
      }),
    );

    const durationMs = performance.now() - startedAt;

    expect(results.filter(Boolean)).toHaveLength(validCount);
    expect(results.filter((connected) => !connected)).toHaveLength(invalidCount);

    await vi.waitFor(
      () => {
        expect(ioServer?.engine.clientsCount).toBe(validCount);
      },
      {
        timeout: 5_000,
      },
    );

    expect(verifyAccessToken).toHaveBeenCalledTimes(validCount + invalidCount);
    expect(durationMs).toBeLessThan(15_000);
  });
});
