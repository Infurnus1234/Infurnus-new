import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
const live = process.env.MAP_REDIS_TESTS === 'true' ? describe : describe.skip;
live('Redis lifecycle and BullMQ live audit', () => {
  let connection: typeof import('../redis.js');
  const key = `auth-audit:${randomUUID()}`;
  beforeAll(async () => {
    connection = await import('../redis.js');
  });
  afterAll(async () => {
    if (connection) {
      await connection.redis.del(key);
      await connection.disconnectRedis();
    }
  });
  it('awaits concurrent connection readiness and reports health', async () => {
    await Promise.all([connection.connectRedis(), connection.connectRedis()]);
    expect(connection.redis.status).toBe('ready');
    expect(await connection.checkRedisHealth()).toBe(true);
    expect(await connection.redis.ping()).toBe('PONG');
  });
  it('round-trips JSON and actually expires keys', async () => {
    const value = JSON.stringify({ verified: true, fixture: 'local' });
    expect(await connection.redis.set(key, value, 'EX', 1)).toBe('OK');
    expect(JSON.parse((await connection.redis.get(key))!)).toEqual({
      verified: true,
      fixture: 'local',
    });
    expect(await connection.redis.ttl(key)).toBeGreaterThanOrEqual(0);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await connection.redis.get(key)).toBeNull();
  });
  it('uses the configured producer and processes an isolated queue with a blocking worker connection', async () => {
    const { notificationQueue } = await import('../../queue/notification.queue.js');
    const producerClient = await notificationQueue.getBackend().connection.client;
    expect(producerClient.status).toBe('ready');
    expect(producerClient.options.host).toBe(connection.redis.options.host);
    expect(producerClient.options.port).toBe(connection.redis.options.port);
    expect(producerClient.options.db).toBe(connection.redis.options.db);
    const queueName = `audit-${randomUUID()}`;
    const queue = new Queue(queueName, { connection: connection.redis });
    // BullMQ blocking consumers require unlimited per-request retries, unlike producers.
    const workerConnection = connection.redis.duplicate({
      maxRetriesPerRequest: null,
      commandTimeout: 0,
    });
    // Zero is an immediate timeout in ioredis; blocking commands need this option omitted.
    delete workerConnection.options.commandTimeout;
    const worker = new Worker(queueName, async (job) => ({ processed: job.data.fixture }), {
      connection: workerConnection,
    });
    try {
      await worker.waitUntilReady();
      const completed = new Promise<void>((resolve, reject) => {
        worker.once('completed', (job) => {
          try {
            expect(job.returnvalue).toEqual({ processed: true });
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        worker.once('failed', (_job, error) => reject(error));
      });
      await queue.add('fixture', { fixture: true });
      await completed;
    } finally {
      await worker.close();
      workerConnection.disconnect();
      await queue.obliterate({ force: true });
      await queue.close();
      await notificationQueue.close();
    }
  });
});
