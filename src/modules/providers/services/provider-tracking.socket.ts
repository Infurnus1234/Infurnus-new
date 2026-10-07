import type { Server } from 'socket.io';
import type { PostgresProviderOperationsRepository } from '../repositories/provider-operations.repository.js';
import { verifyAccessToken } from '../../auth/utils/jwt.js';

// Use the existing authenticated Socket.IO server. Recheck JWT, current account
// and fleet membership for every snapshot; never trust a client fleet/user id.
export function attachProviderTracking(
  io: Server,
  repository: PostgresProviderOperationsRepository,
) {
  let subscriptions = 0;
  io.on('connection', (socket) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let pending = false;
    let generation = 0;
    const stop = () => {
      generation++;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
        subscriptions--;
      }
    };
    const snapshot = async () => {
      if (pending || !socket.connected) return;
      pending = true;
      const currentGeneration = generation;
      try {
        const claims = await verifyAccessToken(socket.handshake.auth.token);
        const rows = await repository.tracking(claims.sub, claims.role);
        if (socket.connected && timer && generation === currentGeneration)
          socket.emit('fleet:tracking', { success: true, data: rows });
      } catch {
        stop();
        if (socket.connected)
          socket.emit('fleet:tracking', {
            success: false,
            error: { code: 'FORBIDDEN', message: 'Fleet tracking access denied' },
          });
      } finally {
        pending = false;
      }
    };
    socket.on(
      'fleet:tracking:subscribe',
      async (payload: unknown, ack?: (response: unknown) => void) => {
        const reply = (response: unknown) => {
          if (typeof ack === 'function') ack(response);
        };
        const subscriptionGeneration = generation;
        if (pending) {
          reply({ success: false, error: { code: 'BUSY' } });
          return;
        }
        if (payload && (typeof payload !== 'object' || Object.keys(payload).length)) {
          reply({ success: false, error: { code: 'INVALID_INPUT' } });
          return;
        }
        if (!timer && subscriptions >= 1000) {
          reply({ success: false, error: { code: 'CAPACITY_EXCEEDED' } });
          return;
        }
        pending = true;
        try {
          const claims = await verifyAccessToken(socket.handshake.auth.token);
          await repository.tracking(claims.sub, claims.role);
          if (!socket.connected || generation !== subscriptionGeneration) return;
          if (!timer) {
            subscriptions++;
            timer = setInterval(() => void snapshot(), 3000);
            timer.unref();
          }
          reply({ success: true });
        } catch {
          stop();
          reply({ success: false, error: { code: 'FORBIDDEN' } });
        } finally {
          pending = false;
        }
        await snapshot();
      },
    );
    socket.on('fleet:tracking:unsubscribe', stop);
    socket.on('disconnect', stop);
  });
}
