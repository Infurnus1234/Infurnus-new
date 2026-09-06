import { describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io';

import { authorizeSocketRole, getAuthenticatedSocket } from '../socket.authorization.js';

function createSocket(auth?: { userId: string; role: string }): Socket {
  return {
    data: auth ? { auth } : {},
  } as unknown as Socket;
}

describe('socket authorization', () => {
  it('returns the authenticated socket identity', () => {
    const socket = createSocket({
      userId: 'user-123',
      role: 'driver',
    });

    expect(getAuthenticatedSocket(socket)).toEqual({
      userId: 'user-123',
      role: 'driver',
    });
  });

  it('rejects unauthenticated sockets', () => {
    const socket = createSocket();

    expect(() => getAuthenticatedSocket(socket)).toThrow('Socket authentication required');
  });

  it('authorizes an allowed role', () => {
    const socket = createSocket({
      userId: 'driver-123',
      role: 'driver',
    });

    expect(authorizeSocketRole(socket, ['driver'])).toEqual({
      userId: 'driver-123',
      role: 'driver',
    });
  });

  it('rejects a role that is not allowed', () => {
    const socket = createSocket({
      userId: 'customer-123',
      role: 'customer',
    });

    expect(() => authorizeSocketRole(socket, ['driver'])).toThrow('Socket authorization failed');
  });
});
