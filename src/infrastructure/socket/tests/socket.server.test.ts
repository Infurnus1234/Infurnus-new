import { createServer, type Server as HttpServer } from 'node:http';

import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyAccessToken } from '../../../modules/auth/utils/jwt.js';
import { createSocketServer } from '../socket.server.js';

vi.mock('../../../modules/auth/utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

describe('Socket.IO server authentication', () => {
  let httpServer: HttpServer | undefined;
  let client: ClientSocket | undefined;

  afterEach(async () => {
    if (client) {
      client.disconnect();
      client = undefined;
    }

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
    createSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer?.listen(0, '127.0.0.1', () => resolve());
    });

    const address = httpServer.address();

    if (!address || typeof address === 'string') {
      throw new Error('Failed to determine test server port');
    }

    return address.port;
  }

  it('accepts a connection with a valid access token', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'user-123',
      role: 'customer',
      type: 'access',
    });

    const port = await startServer();

    client = createClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: 'valid-access-token',
      },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      client?.once('connect', resolve);
      client?.once('connect_error', reject);
    });

    expect(client.connected).toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith('valid-access-token');
  });

  it('rejects a connection without an access token', async () => {
    const port = await startServer();

    client = createClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
    });

    const error = await new Promise<Error>((resolve) => {
      client?.once('connect_error', resolve);
    });

    expect(error.message).toBe('Authentication failed');
    expect(client.connected).toBe(false);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a connection with an empty access token', async () => {
    const port = await startServer();

    client = createClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: '',
      },
      transports: ['websocket'],
    });

    const error = await new Promise<Error>((resolve) => {
      client?.once('connect_error', resolve);
    });

    expect(error.message).toBe('Authentication failed');
    expect(client.connected).toBe(false);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a connection with a whitespace-only access token', async () => {
    const port = await startServer();

    client = createClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: '   ',
      },
      transports: ['websocket'],
    });

    const error = await new Promise<Error>((resolve) => {
      client?.once('connect_error', resolve);
    });

    expect(error.message).toBe('Authentication failed');
    expect(client.connected).toBe(false);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a connection with an invalid access token', async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(new Error('Invalid or expired token'));

    const port = await startServer();

    client = createClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: 'invalid-access-token',
      },
      transports: ['websocket'],
    });

    const error = await new Promise<Error>((resolve) => {
      client?.once('connect_error', resolve);
    });

    expect(error.message).toBe('Authentication failed');
    expect(error.message).not.toContain('Invalid or expired token');
    expect(client.connected).toBe(false);
    expect(verifyAccessToken).toHaveBeenCalledWith('invalid-access-token');
  });

  it('rejects a connection with an expired access token', async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(new Error('JWT expired'));

    const port = await startServer();

    client = createClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: 'expired-access-token',
      },
      transports: ['websocket'],
    });

    const error = await new Promise<Error>((resolve) => {
      client?.once('connect_error', resolve);
    });

    expect(error.message).toBe('Authentication failed');
    expect(error.message).not.toContain('JWT expired');
    expect(client.connected).toBe(false);
    expect(verifyAccessToken).toHaveBeenCalledWith('expired-access-token');
  });

  it('re-authenticates a socket after reconnecting', async () => {
    vi.mocked(verifyAccessToken)
      .mockResolvedValueOnce({
        sub: 'user-123',
        role: 'customer',
        type: 'access',
      })
      .mockResolvedValueOnce({
        sub: 'user-123',
        role: 'customer',
        type: 'access',
      });

    const port = await startServer();

    client = createClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: 'access-token',
      },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      client?.once('connect', resolve);
      client?.once('connect_error', reject);
    });

    expect(verifyAccessToken).toHaveBeenCalledTimes(1);

    client.disconnect();

    client.auth = {
      token: 'new-access-token',
    };

    const reconnectPromise = new Promise<void>((resolve, reject) => {
      client?.once('connect', resolve);
      client?.once('connect_error', reject);
    });

    client.connect();

    await reconnectPromise;

    expect(client.connected).toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledTimes(2);
    expect(verifyAccessToken).toHaveBeenNthCalledWith(1, 'access-token');
    expect(verifyAccessToken).toHaveBeenNthCalledWith(2, 'new-access-token');
  });

  it('rejects a reconnect when the new access token is invalid', async () => {
    vi.mocked(verifyAccessToken)
      .mockResolvedValueOnce({
        sub: 'user-123',
        role: 'customer',
        type: 'access',
      })
      .mockRejectedValueOnce(new Error('JWT expired'));

    const port = await startServer();

    client = createClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: 'valid-access-token',
      },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      client?.once('connect', resolve);
      client?.once('connect_error', reject);
    });

    client.disconnect();

    client.auth = {
      token: 'expired-access-token',
    };

    const reconnectPromise = new Promise<Error>((resolve) => {
      client?.once('connect_error', resolve);
    });

    client.connect();

    const error = await reconnectPromise;

    expect(error.message).toBe('Authentication failed');
    expect(error.message).not.toContain('JWT expired');
    expect(client.connected).toBe(false);
    expect(verifyAccessToken).toHaveBeenCalledTimes(2);
    expect(verifyAccessToken).toHaveBeenLastCalledWith('expired-access-token');
  });
});
