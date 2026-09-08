import { describe, expect, it, vi } from 'vitest';
import { GoogleMapsProvider } from '../providers/google.maps.provider.js';

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('GoogleMapsProvider', () => {
  it('does not make a request without a server-side key', async () => {
    const fetcher = vi.fn();
    const provider = new GoogleMapsProvider(undefined, fetcher);
    await expect(
      provider.calculateRoute({ latitude: 12, longitude: 77 }, { latitude: 13, longitude: 78 }),
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps a route response without exposing the key in logs', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        routes: [{ legs: [{ distance: { value: 1200 }, duration: { value: 90 } }] }],
      }),
    );
    const logger = vi.fn();
    const provider = new GoogleMapsProvider('server-only-key', fetcher, Date.now, logger);
    await expect(
      provider.calculateRoute({ latitude: 12, longitude: 77 }, { latitude: 13, longitude: 78 }),
    ).resolves.toMatchObject({ distanceMeters: 1200, durationSeconds: 90 });
    expect(logger).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ key: expect.anything() }),
    );
  });

  it('bounds route matrix origins before making the request', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ rows: [] }));
    const provider = new GoogleMapsProvider('key', fetcher);
    await provider.calculateMatrix(
      Array.from({ length: 100 }, (_, index) => ({ latitude: index, longitude: index })),
      { latitude: 12, longitude: 77 },
    );
    const url = String(fetcher.mock.calls[0]?.[0]);
    expect((new URL(url).searchParams.get('origins') ?? '').split('|')).toHaveLength(20);
  });

  it('bounds place results and rejects short input without a request', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        predictions: Array.from({ length: 10 }, (_, index) => ({
          place_id: String(index),
          description: `Place ${index}`,
        })),
      }),
    );
    const provider = new GoogleMapsProvider('key', fetcher, () => 1000);
    await expect(provider.places('ab')).resolves.toEqual([]);
    await expect(provider.places('Bengaluru')).resolves.toHaveLength(5);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not repeat Places calls inside the configured interval', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ predictions: [] }));
    let clock = 1000;
    const provider = new GoogleMapsProvider('key', fetcher, () => clock);
    await provider.places('Bengaluru');
    clock += 1;
    await provider.places('Bengaluru');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and then returns a safe fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({}, false, 503));
    const provider = new GoogleMapsProvider('key', fetcher);
    await expect(provider.geocode('Bengaluru')).resolves.toBeNull();
    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not retry permanent client failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({}, false, 400));
    const provider = new GoogleMapsProvider('key', fetcher);
    await provider.geocode('Bengaluru');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
