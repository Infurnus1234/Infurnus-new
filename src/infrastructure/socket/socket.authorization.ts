import type { Socket } from 'socket.io';

import type { AuthenticatedSocketData } from './socket.auth.js';

export function getAuthenticatedSocket(socket: Socket): AuthenticatedSocketData {
  const auth = socket.data.auth;

  if (!auth) {
    throw new Error('Socket authentication required');
  }

  return auth;
}

export function authorizeSocketRole(
  socket: Socket,
  allowedRoles: readonly string[],
): AuthenticatedSocketData {
  const auth = getAuthenticatedSocket(socket);

  if (!allowedRoles.includes(auth.role)) {
    throw new Error('Socket authorization failed');
  }

  return auth;
}
