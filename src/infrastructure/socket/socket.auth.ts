import type { Socket } from 'socket.io';

import { verifyAccessToken } from '../../modules/auth/utils/jwt.js';

export interface AuthenticatedSocketData {
  userId: string;
  role: string;
}

export async function authenticateSocket(socket: Socket): Promise<void> {
  const token = socket.handshake.auth?.token;

  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Authentication required');
  }

  const payload = await verifyAccessToken(token);

  socket.data.auth = {
    userId: payload.sub,
    role: payload.role,
  } satisfies AuthenticatedSocketData;
}
