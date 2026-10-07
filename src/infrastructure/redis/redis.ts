import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

if (!env.REDIS_URL) {
  throw new Error('REDIS_URL is required to initialize Redis');
}

const redisOptions = {
  connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
  commandTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
  maxRetriesPerRequest: env.REDIS_MAX_RETRIES,
  enableReadyCheck: true,
  lazyConnect: true,
};

export const redis = new Redis(env.REDIS_URL, redisOptions);

redis.on('connect', () => {
  console.log('[Redis] Connecting...');
});

redis.on('ready', () => {
  console.log('[Redis] Connection ready');
});

redis.on('error', () => {
  console.error('[Redis] Connection unavailable');
});

redis.on('close', () => {
  console.warn('[Redis] Connection closed');
});

redis.on('reconnecting', (delay: number) => {
  console.warn(`[Redis] Reconnecting in ${delay}ms...`);
});

let connecting: Promise<void> | undefined;

export async function connectRedis(): Promise<void> {
  if (redis.status === 'ready') return;
  if (connecting) return connecting;
  connecting = (async () => {
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect();
    } else {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          redis.off('ready', ready);
          redis.off('end', ended);
        };
        const ready = () => {
          cleanup();
          resolve();
        };
        const ended = () => {
          cleanup();
          reject(new Error('Redis connection ended'));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Redis readiness timed out'));
        }, env.REDIS_CONNECT_TIMEOUT_MS);
        redis.once('ready', ready);
        redis.once('end', ended);
      });
    }
  })().finally(() => {
    connecting = undefined;
  });
  return connecting;
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status === 'end') {
    return;
  }

  if (redis.status !== 'ready') {
    redis.disconnect();
    return;
  }
  try {
    await redis.quit();
  } finally {
    redis.disconnect();
  }
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    if (redis.status !== 'ready') return false;
    const response = await redis.ping();

    return response === 'PONG';
  } catch {
    console.error('[Redis] Health check unavailable');

    return false;
  }
}
