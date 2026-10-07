import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

export interface MapCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  lock(key: string, ttlMs: number): Promise<string | null>;
  unlock(key: string, token: string): Promise<void>;
  setIfLocked?(key: string, value: string, ttlSeconds: number, token: string): Promise<boolean>;
}

/** Uses the existing shared Redis connection; fails quickly when disconnected. */
export class RedisMapCache implements MapCache {
  constructor(private readonly redis: Redis) {}
  private ready() {
    if (this.redis.status !== 'ready') throw new Error('Map cache unavailable');
  }
  async get(key: string) {
    this.ready();
    return this.redis.get(key);
  }
  async set(key: string, value: string, ttl: number) {
    this.ready();
    await this.redis.set(key, value, 'EX', ttl);
  }
  async lock(key: string, ttl: number) {
    this.ready();
    const token = randomUUID();
    return (await this.redis.set(key, token, 'PX', ttl, 'NX')) === 'OK' ? token : null;
  }
  async setIfLocked(key: string, value: string, ttl: number, token: string) {
    this.ready();
    return (
      (await this.redis.eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then redis.call('set',KEYS[2],ARGV[2],'EX',ARGV[3]); return 1 else return 0 end",
        2,
        key + ':lock',
        key,
        token,
        value,
        ttl,
      )) === 1
    );
  }
  async unlock(key: string, token: string) {
    this.ready();
    await this.redis.eval(
      "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  }
}
