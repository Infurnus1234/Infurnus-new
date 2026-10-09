import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../../common/errors/app-error.js';

/** Standby exposes liveness only. Application readiness requires exclusive ownership. */
export function respondWhileStandby(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url?.split('?')[0] === '/health') {
    res.writeHead(200).end(JSON.stringify({ status: 'alive', state: 'standby' }));
    return;
  }
  res.setHeader('Retry-After', '2');
  res.writeHead(503).end(
    JSON.stringify({
      success: false,
      error: { code: 'BACKEND_STANDBY', message: 'Backend ownership is not ready' },
    }),
  );
}

export async function waitForBackendInstance(
  acquire: () => Promise<() => Promise<void>>,
  signal: AbortSignal,
  standbyOnly = false,
): Promise<() => Promise<void>> {
  for (;;) {
    signal.throwIfAborted();
    if (standbyOnly) {
      await delay(2000, undefined, { signal });
      continue;
    }
    try {
      const release = await acquire();
      if (signal.aborted) {
        await release();
        signal.throwIfAborted();
      }
      return release;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'BACKEND_SINGLE_INSTANCE_REQUIRED') {
        throw error;
      }
      await delay(2000, undefined, { signal });
    }
  }
}
