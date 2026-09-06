import type { Socket } from 'socket.io';

import { getAuthenticatedSocket } from './socket.authorization.js';

export const rideRoom = (rideId: string): string => `ride:${rideId}`;

export async function joinAuthorizedRideRoom(
  socket: Socket,
  rideId: string,
  isAuthorized: (userId: string, rideId: string) => Promise<boolean>,
): Promise<void> {
  const { userId } = getAuthenticatedSocket(socket);

  const authorized = await isAuthorized(userId, rideId);

  if (!authorized) {
    throw new Error('Ride room authorization failed');
  }

  await socket.join(rideRoom(rideId));
}

export async function leaveRideRoom(socket: Socket, rideId: string): Promise<void> {
  getAuthenticatedSocket(socket);

  await socket.leave(rideRoom(rideId));
}
