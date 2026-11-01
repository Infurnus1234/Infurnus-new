import type { Redis } from 'ioredis';
import type { DriverLocation } from '../types/driver.js';
import type { LiveRideLocation } from '../types/ride-map.js';

/** Driver keys contain GPS data only. Ride access must be authorized before reading. */
export class LiveLocationCache {
  constructor(
    private readonly redis: Redis,
    readonly ttlSeconds = 120,
    readonly persistMs = 10000,
  ) {}

  async seed(
    profile: string,
    load: () => Promise<DriverLocation | null>,
    force = false,
  ): Promise<boolean> {
    if (this.redis.status !== 'ready') return false;
    if (!force && (await this.redis.exists(`ride:driver-location:${profile}`))) return true;
    const previous = await load();
    if (previous)
      await this.redis.eval(
        `
      local raw = redis.call('GET',KEYS[1])
      if not raw or cjson.decode(raw).version < tonumber(ARGV[2]) then
        redis.call('SET',KEYS[1],ARGV[1],'EX',ARGV[3])
      end
    `,
        1,
        `ride:driver-location:${profile}`,
        JSON.stringify({
          ...previous,
          timestamp: previous.recordedAt.toISOString(),
          version: previous.recordedAt.getTime(),
        }),
        previous.recordedAt.getTime(),
        this.ttlSeconds,
      );
    return true;
  }

  async accept(profile: string, location: DriverLocation): Promise<number | null> {
    if (this.redis.status !== 'ready') return null;
    const timestamp = location.recordedAt.getTime();
    const value = JSON.stringify({ ...location, timestamp: location.recordedAt.toISOString() });
    try {
      return Number(
        await this.redis.eval(
          `
        local raw = redis.call('GET', KEYS[1])
        if raw then
          local old = cjson.decode(raw)
          local dt = tonumber(ARGV[2]) - old.version
          if dt <= 0 then return 0 end
          if dt < 500 then return -1 end
          local next = cjson.decode(ARGV[1])
          local dy = (next.latitude-old.latitude)*111320
          local dx = (next.longitude-old.longitude)*111320*math.cos(next.latitude*math.pi/180)
          local allowance = (next.accuracy or 0)+(old.accuracy or 0)+50
          if math.sqrt(dx*dx+dy*dy) > dt/1000*75+allowance then return -2 end
        end
        local next = cjson.decode(ARGV[1]); next.version = tonumber(ARGV[2])
        redis.call('SET', KEYS[1], cjson.encode(next), 'EX', ARGV[3])
        local persisted = redis.call('GET', KEYS[2])
        if not persisted or tonumber(ARGV[2])-tonumber(persisted) >= tonumber(ARGV[4]) then
          redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3]); return 2
        end
        return 1
      `,
          2,
          `ride:driver-location:${profile}`,
          `ride:driver-location:${profile}:persist`,
          value,
          timestamp,
          this.ttlSeconds,
          this.persistMs,
        ),
      );
    } catch {
      return null;
    }
  }

  async latest(profile: string): Promise<LiveRideLocation | null> {
    if (this.redis.status !== 'ready') return null;
    try {
      const raw = await this.redis.get(`ride:driver-location:${profile}`);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return {
        latitude: value.latitude,
        longitude: value.longitude,
        timestamp: value.timestamp,
        heading: value.heading,
        speed: value.speed,
        accuracy: value.accuracy,
      };
    } catch {
      return null;
    }
  }

  async rejectPersistence(profile: string, recordedAt: Date): Promise<void> {
    if (this.redis.status !== 'ready') return;
    try {
      await this.redis.eval(
        `
        local raw = redis.call('GET',KEYS[1])
        if raw and cjson.decode(raw).version == tonumber(ARGV[1]) then redis.call('DEL',KEYS[1]) end
        if redis.call('GET',KEYS[2]) == ARGV[1] then redis.call('DEL',KEYS[2]) end
      `,
        2,
        `ride:driver-location:${profile}`,
        `ride:driver-location:${profile}:persist`,
        recordedAt.getTime(),
      );
    } catch {
      /* The bounded TTL also releases failed persistence reservations. */
    }
  }
}
