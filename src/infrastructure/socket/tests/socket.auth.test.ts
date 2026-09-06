import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';

import { verifyAccessToken } from '../../../modules/auth/utils/jwt.js';
import { authenticateSocket } from '../socket.auth.js';

vi.mock('../../../modules/auth/utils/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

function createSocket(token?: unknown): Socket {
  return {
    handshake: {
      auth: token === undefined ? {} : { token },
    },
    data: {},
  } as unknown as Socket;
}

describe('authenticateSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates a socket with a valid access token', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'user-123',
      role: 'customer',
      type: 'access',
    });

    const socket = createSocket('valid-access-token');

    await authenticateSocket(socket);

    expect(verifyAccessToken).toHaveBeenCalledWith('valid-access-token');
    expect(socket.data.auth).toEqual({
      userId: 'user-123',
      role: 'customer',
    });
  });

  it('rejects when the token is missing', async () => {
    const socket = createSocket();

    await expect(authenticateSocket(socket)).rejects.toThrow('Authentication required');

    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects when the token is not a string', async () => {
    const socket = createSocket(123);

    await expect(authenticateSocket(socket)).rejects.toThrow('Authentication required');

    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects when the access token is invalid or expired', async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(new Error('Invalid or expired token'));

    const socket = createSocket('invalid-access-token');

    await expect(authenticateSocket(socket)).rejects.toThrow('Invalid or expired token');

    expect(socket.data.auth).toBeUndefined();
  });
});
