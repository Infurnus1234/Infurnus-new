import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRideDispatchQueue } from '../ride-dispatch.queue.js';
import type { RideRepository } from '../../../modules/rides/repositories/ride.repository.js';
import type { Ride } from '../../../modules/rides/types/ride.js';
const url = process.env.DISPATCH_QA_REDIS_URL || 'redis://127.0.0.1:6379';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
describe.skipIf(process.env.REDIS_DISPATCH_TESTS !== 'true')(
  'real local BullMQ dispatch deadlines',
  () => {
    function setup(terminal = false) {
      const name = `dispatch-test-${randomUUID()}`;
      let pending = true;
      const ride = {
        id: randomUUID(),
        status: terminal ? 'cancelled' : 'searching',
        assignedDriverId: null,
      } as Ride;
      const findById = vi.fn(async () => ride),
        finishDispatchAttempt = vi.fn(async () => {
          if (!pending) return false;
          pending = false;
          return true;
        });
      const dispatch = { dispatch: vi.fn(async () => {}) };
      const repo = { findById, finishDispatchAttempt } as unknown as RideRepository;
      let worker = startRideDispatchQueue(url, repo, dispatch, name);
      cleanups.push(async () => {
        await worker.close();
        const connection = new Redis(url, { maxRetriesPerRequest: 0 });
        const queue = new Queue(name, { connection });
        // Only this test's UUID-named queue is removed. Shared Redis is never flushed.
        await queue.obliterate({ force: true });
        await queue.close();
        connection.disconnect();
      });
      return {
        ride,
        findById,
        finishDispatchAttempt,
        dispatch,
        get worker() {
          return worker;
        },
        async restart() {
          await worker.close();
          worker = startRideDispatchQueue(url, repo, dispatch, name);
        },
      };
    }
    it('deduplicates a scheduled deadline and advances only once', async () => {
      const test = setup(),
        driver = randomUUID(),
        deadline = new Date(Date.now() + 200);
      await vi.waitFor(
        async () => {
          await test.worker.schedule(test.ride.id, driver, deadline);
        },
        { timeout: 5000 },
      );
      await test.worker.schedule(test.ride.id, driver, deadline);
      await vi.waitFor(() => expect(test.dispatch.dispatch).toHaveBeenCalledTimes(1), {
        timeout: 5000,
      });
      expect(test.finishDispatchAttempt).toHaveBeenCalledTimes(1);
    });
    it('ignores timeout jobs for terminal rides', async () => {
      const test = setup(true);
      await vi.waitFor(
        async () => {
          await test.worker.schedule(test.ride.id, randomUUID(), new Date());
        },
        { timeout: 5000 },
      );
      await vi.waitFor(() => expect(test.findById).toHaveBeenCalled(), { timeout: 5000 });
      expect(test.finishDispatchAttempt).not.toHaveBeenCalled();
      expect(test.dispatch.dispatch).not.toHaveBeenCalled();
    });
    it('recovers delayed work after the worker restarts', async () => {
      const test = setup(),
        driver = randomUUID(),
        deadline = new Date(Date.now() + 500);
      await vi.waitFor(
        async () => {
          await test.worker.schedule(test.ride.id, driver, deadline);
        },
        { timeout: 5000 },
      );
      await test.restart();
      await vi.waitFor(() => expect(test.dispatch.dispatch).toHaveBeenCalledTimes(1), {
        timeout: 5000,
      });
    });
    it('retries a transient database failure without duplicating progression', async () => {
      const test = setup();
      test.findById.mockRejectedValueOnce(new Error('synthetic transient database outage'));
      await vi.waitFor(
        async () => {
          await test.worker.schedule(test.ride.id, randomUUID(), new Date());
        },
        { timeout: 5000 },
      );
      await vi.waitFor(() => expect(test.dispatch.dispatch).toHaveBeenCalledTimes(1), {
        timeout: 6000,
      });
      expect(test.findById.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  },
);
