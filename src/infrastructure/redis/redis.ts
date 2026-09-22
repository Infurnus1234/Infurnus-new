import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

if (!env.REDIS_URL) {
  throw new Error('REDIS_URL is required to initialize Redis');
}

const redisOptions = {
  connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
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

redis.on('error', (error: Error) => {
  console.error('[Redis] Connection error:', error.message);
});

redis.on('close', () => {
  console.warn('[Redis] Connection closed');
});

redis.on('reconnecting', (delay: number) => {
  console.warn(`[Redis] Reconnecting in ${delay}ms...`);
});

export async function connectRedis(): Promise<void> {
  if (redis.status === 'ready' || redis.status === 'connecting') {
    return;
  }

  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status === 'end') {
    return;
  }

  await redis.quit();
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const response = await redis.ping();

    return response === 'PONG';
  } catch (error) {
    console.error('[Redis] Health check failed:', error instanceof Error ? error.message : error);

    return false;
  }
}
