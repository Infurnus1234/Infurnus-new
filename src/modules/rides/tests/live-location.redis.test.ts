import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { describe, it, expect, vi } from 'vitest';
import { LiveLocationCache } from '../repositories/live-location.cache.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';

const live = process.env.LIVE_TRACKING_REDIS_TESTS === 'true' ? describe : describe.skip;
live('real Redis live tracking', () => {
  it('releases failed persistence without deleting a newer accepted fix', async () => {
    const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true });
    await redis.connect();
    const id = randomUUID(),
      now = new Date();
    const cache = new LiveLocationCache(redis);
    const first = { latitude: 25.5941, longitude: 85.1376, recordedAt: now };
    const next = { ...first, recordedAt: new Date(now.getTime() + 1000) };
    try {
      expect(await cache.accept(id, first)).toBe(2);
      await cache.rejectPersistence(id, now);
      expect(await cache.latest(id)).toBeNull();
      expect(await cache.accept(id, next)).toBe(2);
      await cache.rejectPersistence(id, now);
      expect(await cache.latest(id)).toMatchObject({ timestamp: next.recordedAt.toISOString() });
      // A process restart/Redis recovery must also reconcile an existing, older cache key.
      const persisted = new Date(now.getTime() + 5000);
      await cache.seed(id, async () => ({ ...first, recordedAt: persisted }), true);
      expect(await cache.accept(id, { ...first, recordedAt: new Date(now.getTime() + 4000) })).toBe(
        0,
      );
    } finally {
      await redis.del(`ride:driver-location:${id}`, `ride:driver-location:${id}:persist`);
      await redis.quit();
    }
  });
  it('accepts 60 one-second Patna samples with six DB writes; recovers heading; rejects replay, flood and jumps', async () => {
    const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true });
    await redis.connect();
    const id = randomUUID();
    const cache = new LiveLocationCache(redis);
    const start = Date.now() - 60000;
    const query = vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT') ? [] : [{ id }],
      rowCount: 1,
    }));
    const repo = new PostgresDriverRepository({ query } as never);
    repo.trackingCache = cache;
    const fix = (i: number) => ({
      latitude: 25.5941 + i * 0.00003,
      longitude: 85.1376,
      heading: 0,
      speed: 4,
      accuracy: 5,
      recordedAt: new Date(start + i * 1000),
    });
    try {
      for (let i = 0; i < 60; i++) expect(await repo.updateLocation(id, fix(i))).toBe(true);
      expect(query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'))).toHaveLength(6);
      expect(await cache.latest(id)).toMatchObject({
        latitude: fix(59).latitude,
        heading: 0,
        speed: 4,
      });
      expect(await repo.updateLocation(id, fix(59))).toBe(false);
      expect(await repo.updateLocation(id, fix(58))).toBe(false);
      expect(
        await repo.updateLocation(id, { ...fix(60), recordedAt: new Date(start + 59100) }),
      ).toBe(false);
      await expect(repo.updateLocation(id, { ...fix(60), latitude: 26 })).rejects.toMatchObject({
        code: 'DRIVER_LOCATION_IMPLAUSIBLE',
        statusCode: 409,
      });
      expect(await redis.ttl(`ride:driver-location:${id}`)).toBeGreaterThan(0);
      expect(await redis.ttl(`ride:driver-location:${id}`)).toBeLessThanOrEqual(120);
      // Participant authorization happens before Redis lookup, including reconnect recovery.
      const rideQuery = vi.fn(async () => ({ rows: [] }));
      const rides = new PostgresRideRepository({ query: rideQuery } as never);
      rides.trackingCache = cache;
      const latest = vi.spyOn(cache, 'latest');
      expect(await rides.getRideMapSnapshot('unrelated', 'intruder', 'user')).toBeNull();
      expect(latest).not.toHaveBeenCalled();
    } finally {
      await redis.del(`ride:driver-location:${id}`, `ride:driver-location:${id}:persist`);
      await redis.quit();
    }
  });
  it('seeds a cold key from PostgreSQL so a restart cannot accept older GPS', async () => {
    const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true });
    await redis.connect();
    const id = randomUUID(),
      now = new Date();
    const cache = new LiveLocationCache(redis, 1);
    try {
      await cache.seed(id, async () => ({
        latitude: 25.5941,
        longitude: 85.1376,
        recordedAt: now,
      }));
      expect(
        await cache.accept(id, {
          latitude: 25.5941,
          longitude: 85.1376,
          recordedAt: new Date(now.getTime() - 1000),
        }),
      ).toBe(0);
      await expect.poll(() => cache.latest(id), { timeout: 3000, interval: 100 }).toBeNull();
    } finally {
      await redis.del(`ride:driver-location:${id}`, `ride:driver-location:${id}:persist`);
      await redis.quit();
    }
  });
});

describe('Location rejection classification', () => {
  it('reports implausible movement distinctly without persisting or weakening replay protection', async () => {
    const query = vi.fn();
    const repo = new PostgresDriverRepository({ query } as never);
    const cache = { seed: vi.fn(async () => false), accept: vi.fn(async () => -2) };
    repo.trackingCache = cache as never;
    const fix = { latitude: 25.6, longitude: 85.1, recordedAt: new Date() };
    await expect(repo.updateLocation('profile', fix)).rejects.toMatchObject({
      code: 'DRIVER_LOCATION_IMPLAUSIBLE',
      statusCode: 409,
    });
    expect(query).not.toHaveBeenCalled();
    cache.accept.mockResolvedValue(0);
    expect(await repo.updateLocation('profile', fix)).toBe(false);
    cache.accept.mockResolvedValue(-1);
    expect(await repo.updateLocation('profile', fix)).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
