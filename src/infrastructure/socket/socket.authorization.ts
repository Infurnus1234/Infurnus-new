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

  const mode =
    socket.handshake?.auth?.providerMode ?? socket.handshake?.headers?.['x-provider-mode'];
  const roles =
    auth.role === 'driver_fleet_owner'
      ? mode === 'driver'
        ? ['driver']
        : mode === 'fleet_owner'
          ? ['fleet_owner']
          : ['driver', 'fleet_owner', 'driver_fleet_owner']
      : [auth.role];
  if (!allowedRoles.some((role) => roles.includes(role))) {
    throw new Error('Socket authorization failed');
  }

  return auth;
}

export function canActAsDriver(socket: Socket): boolean {
  try {
    authorizeSocketRole(socket, ['driver']);
    return true;
  } catch {
    return false;
  }
}
