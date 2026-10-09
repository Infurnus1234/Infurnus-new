import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RedisMapCache } from '../map.cache.js';
import { CommonMapService } from '../map.service.js';
import { mapConfig } from '../map.config.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
const live = process.env.MAP_REDIS_TESTS === 'true' ? describe : describe.skip;
live('live Redis map caching and distributed deduplication', () => {
  let connection: typeof import('../../../infrastructure/redis/index.js');
  let cache: RedisMapCache;
  const namespace = `fixture-${randomUUID()}`;
  beforeAll(async () => {
    connection = await import('../../../infrastructure/redis/index.js');
    await connection.connectRedis();
    expect(await connection.redis.ping()).toBe('PONG');
    cache = new RedisMapCache(connection.redis);
  });
  afterAll(async () => {
    if (!connection) return;
    let cursor = '0';
    do {
      const result = await connection.redis.scan(
        cursor,
        'MATCH',
        `map:v1:${namespace}:*`,
        'COUNT',
        100,
      );
      cursor = result[0];
      if (result[1].length) await connection.redis.del(...result[1]);
    } while (cursor !== '0');
    await connection.disconnectRedis();
  });
  it('stores, hits, and expires actual Redis data', async () => {
    const key = `map:v1:${namespace}:expiry`;
    expect(await cache.get(key)).toBeNull();
    await cache.set(key, 'value', 1);
    expect(await cache.get(key)).toBe('value');
    const ttl = await connection.redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1000);
    await expect.poll(() => cache.get(key), { timeout: 5000, interval: 100 }).toBeNull();
  });
  it('deduplicates identical requests from two independent service instances', async () => {
    const provider: MapProvider = {
      providerName: namespace,
      calculateRoute: async () => null,
      calculateMatrix: async () => [],
      places: async () => [],
      geocode: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { latitude: 25.5941, longitude: 85.1376 };
      }),
    };
    const config = { ...mapConfig, providerContentCaching: true };
    const one = new CommonMapService(provider, cache, config, Date.now, () => {}),
      two = new CommonMapService(provider, cache, config, Date.now, () => {});
    const results = await Promise.all([
      one.geocode('patna junction'),
      two.geocode('PATNA JUNCTION'),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(provider.geocode).toHaveBeenCalledTimes(1);
  });
  it('does not let an expired lock owner release a newer lock', async () => {
    const key = `map:v1:${namespace}:lock-test`;
    const old = await cache.lock(key, 20);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const newer = await cache.lock(key, 1000);
    expect(newer).not.toBeNull();
    await cache.unlock(key, old!);
    expect(await cache.lock(key, 1000)).toBeNull();
    await cache.unlock(key, newer!);
    expect(await cache.lock(key, 1000)).not.toBeNull();
  });
  it('sanitizes shared Redis errors without logging credentials or locations', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      connection.redis.emit('error', new Error('redis://owner:secret-fixture@private-location'));
      expect(errorLog).toHaveBeenCalledWith('[Redis] Connection unavailable');
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret-fixture');
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private-location');
      expect(await connection.redis.ping()).toBe('PONG');
    } finally {
      errorLog.mockRestore();
    }
  });
  it('fences publication by an expired owner while allowing the current owner', async () => {
    const key = 'map:v1:' + namespace + ':fenced-result';
    const expired = await cache.lock(key + ':lock', 10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const current = await cache.lock(key + ':lock', 1000);
    expect(await cache.setIfLocked(key, 'stale', 10, expired!)).toBe(false);
    expect(await cache.get(key)).toBeNull();
    expect(await cache.setIfLocked(key, 'current', 10, current!)).toBe(true);
    expect(await cache.get(key)).toBe('current');
    await cache.unlock(key + ':lock', current!);
  });
});
