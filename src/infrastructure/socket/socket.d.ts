import type { AuthenticatedSocketData } from './socket.auth.js';

declare module 'socket.io' {
  interface SocketData {
    auth?: AuthenticatedSocketData;
  }
}

export {};
