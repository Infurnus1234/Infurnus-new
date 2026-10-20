import { createServer } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error.js';
import { respondWhileStandby, waitForBackendInstance } from './backend-standby.js';

afterEach(() => vi.useRealTimers());

describe('revision standby', () => {
  it('never acquires even a free lock when explicitly deployed as a preview', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const acquire = vi.fn();
    const waiting = waitForBackendInstance(acquire, controller.signal, true);
    const rejected = expect(waiting).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(6000);
    expect(acquire).not.toHaveBeenCalled();
    controller.abort();
    await rejected;
  });
  it('exposes liveness but blocks readiness, auth, rides and socket handshakes', async () => {
    const server = createServer(respondWhileStandby);
    await request(server).get('/health').expect(200);
    for (const path of ['/health/ready', '/ready', '/auth/google', '/rides', '/socket.io/']) {
      const response = await request(server).post(path).expect(503);
      expect(response.body.error.code).toBe('BACKEND_STANDBY');
    }
    await request(server).get('/health/ready').expect(503);
  });

  it('waits for real ownership conflict and activates only after acquisition', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const acquire = vi
      .fn()
      .mockRejectedValueOnce(new AppError('BACKEND_SINGLE_INSTANCE_REQUIRED', 'Owned', 503))
      .mockResolvedValueOnce(release);
    const waiting = waitForBackendInstance(acquire, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1999);
    expect(acquire).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toBe(release);
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it('does not reinterpret connection failure as a stale owner', async () => {
    const failure = new Error('Database unavailable');
    const acquire = vi.fn().mockRejectedValue(failure);
    await expect(waitForBackendInstance(acquire, new AbortController().signal)).rejects.toBe(
      failure,
    );
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('cancels waiting during shutdown without acquiring ownership', async () => {
    const controller = new AbortController();
    controller.abort();
    const acquire = vi.fn();
    await expect(waitForBackendInstance(acquire, controller.signal)).rejects.toThrow();
    expect(acquire).not.toHaveBeenCalled();
  });

  it('releases ownership obtained concurrently with shutdown', async () => {
    const controller = new AbortController();
    const release = vi.fn(async () => {});
    const acquire = async () => {
      controller.abort();
      return release;
    };
    await expect(waitForBackendInstance(acquire, controller.signal)).rejects.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
