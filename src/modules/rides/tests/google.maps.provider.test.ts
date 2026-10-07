import { describe, expect, it, vi } from 'vitest';
import { GoogleMapsProvider } from '../providers/google.maps.provider.js';

vi.mock('../../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/env.js')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      GOOGLE_MAPS_API_KEY: 'non-secret-default-key',
      GOOGLE_REQUEST_TIMEOUT_MS: 20,
    },
  };
});

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('GoogleMapsProvider', () => {
  it('identifies REQUEST_DENIED without exposing provider error text or credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({ status: 'REQUEST_DENIED', error_message: 'private-fixture-key' }),
      );
    await expect(
      new GoogleMapsProvider('private-fixture-key', fetcher).places('PAT'),
    ).rejects.toMatchObject({
      code: 'MAP_PROVIDER_AUTHORIZATION',
      message: 'Map provider authorization failed (REQUEST_DENIED)',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains configured-key behavior when the constructor argument is omitted', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        response({ routes: [{ legs: [{ distance: { value: 1000 }, duration: { value: 60 } }] }] }),
      );
    try {
      await expect(
        new GoogleMapsProvider().calculateRoute(
          { latitude: 12, longitude: 77 },
          { latitude: 13, longitude: 78 },
        ),
      ).resolves.toMatchObject({ distanceMeters: 1000, durationSeconds: 60 });
      expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('key')).toBe(
        'non-secret-default-key',
      );
    } finally {
      fetcher.mockRestore();
    }
  });
  it('does not make a request without a server-side key', async () => {
    const fetcher = vi.fn();
    const provider = new GoogleMapsProvider(undefined, fetcher);

    await expect(
      provider.calculateRoute({ latitude: 12, longitude: 77 }, { latitude: 13, longitude: 78 }),
    ).rejects.toMatchObject({ code: 'MAP_PROVIDER_NOT_CONFIGURED', statusCode: 503 });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps a route response without exposing the key in logs', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        routes: [
          {
            legs: [
              {
                distance: { value: 1200 },
                duration: { value: 90 },
              },
            ],
          },
        ],
      }),
    );

    const logger = vi.fn();
    const provider = new GoogleMapsProvider('server-only-key', fetcher, Date.now, logger);

    await expect(
      provider.calculateRoute({ latitude: 12, longitude: 77 }, { latitude: 13, longitude: 78 }),
    ).resolves.toMatchObject({
      distanceMeters: 1200,
      durationSeconds: 90,
    });

    expect(logger).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ key: expect.anything() }),
    );
  });

  it('bounds route matrix origins before making the request', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        rows: Array.from({ length: 20 }, () => ({ elements: [{ status: 'ZERO_RESULTS' }] })),
      }),
    );
    const provider = new GoogleMapsProvider('key', fetcher);

    await provider.calculateMatrix(
      Array.from({ length: 100 }, (_, index) => ({
        latitude: index,
        longitude: index,
      })),
      { latitude: 12, longitude: 77 },
    );

    const url = String(fetcher.mock.calls[0]?.[0]);

    expect((new URL(url).searchParams.get('origins') ?? '').split('|')).toHaveLength(20);
  });

  it('preserves route matrix positions when a Google element fails', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        rows: [
          {
            elements: [
              {
                status: 'OK',
                distance: { value: 200 },
                duration: { value: 100 },
              },
            ],
          },
          { elements: [{ status: 'ZERO_RESULTS' }] },
          {
            elements: [
              {
                status: 'OK',
                distance: { value: 100 },
                duration: { value: 50 },
              },
            ],
          },
        ],
      }),
    );

    const provider = new GoogleMapsProvider('key', fetcher);

    await expect(
      provider.calculateMatrix(
        [
          { latitude: 12.1, longitude: 77.1 },
          { latitude: 12.2, longitude: 77.2 },
          { latitude: 12.3, longitude: 77.3 },
        ],
        { latitude: 12, longitude: 77 },
      ),
    ).resolves.toEqual([
      {
        origin: {
          latitude: 12.1,
          longitude: 77.1,
        },
        route: {
          distanceMeters: 200,
          durationSeconds: 100,
        },
      },
      {
        origin: {
          latitude: 12.2,
          longitude: 77.2,
        },
        route: null,
      },
      {
        origin: {
          latitude: 12.3,
          longitude: 77.3,
        },
        route: {
          distanceMeters: 100,
          durationSeconds: 50,
        },
      },
    ]);
  });

  it('bounds place results, rejects empty input and forwards partial text', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        predictions: Array.from({ length: 10 }, (_, index) => ({
          place_id: String(index),
          description: `Place ${index}`,
        })),
      }),
    );

    const provider = new GoogleMapsProvider('key', fetcher, () => 1000);

    await expect(provider.places(' ')).resolves.toEqual([]);
    for (const query of ['P', 'PA', 'PAT', 'M', 'MU', 'MUJ']) {
      await expect(provider.places(query)).resolves.toHaveLength(5);
    }
    await expect(provider.places('Bengaluru')).resolves.toHaveLength(5);

    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(
      fetcher.mock.calls.slice(0, 6).map(([url]) => new URL(String(url)).searchParams.get('input')),
    ).toEqual(['P', 'PA', 'PAT', 'M', 'MU', 'MUJ']);
  });

  it('does not globally suppress independent Places requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ predictions: [] }));

    let clock = 1000;

    const provider = new GoogleMapsProvider('key', fetcher, () => clock);

    await provider.places('Patna');

    clock += 1;

    await provider.places('Patna Junction');

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries transient failures and then rejects unavailable provider work', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({}, false, 503));

    const provider = new GoogleMapsProvider('key', fetcher);

    await expect(provider.geocode('Bengaluru')).rejects.toMatchObject({
      code: 'MAP_PROVIDER_UNAVAILABLE',
    });

    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not retry permanent client failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({}, false, 400));

    const provider = new GoogleMapsProvider('key', fetcher);

    await expect(provider.geocode('Bengaluru')).rejects.toMatchObject({
      code: 'MAP_PROVIDER_UNAVAILABLE',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429, 500])(
    'does not report HTTP %s as an empty search success',
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(response({}, false, status));
      const logger = vi.fn();
      const provider = new GoogleMapsProvider('private-fixture-key', fetcher, Date.now, logger);
      await expect(provider.places('pat')).rejects.toMatchObject({
        code:
          status === 401 || status === 403
            ? 'MAP_PROVIDER_AUTHORIZATION'
            : 'MAP_PROVIDER_UNAVAILABLE',
      });
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3);
      expect(JSON.stringify(logger.mock.calls)).not.toContain('private-fixture-key');
      expect(JSON.stringify(logger.mock.calls)).not.toContain('input=');
    },
  );
  it('distinguishes provider denial from legitimate zero results', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ status: 'REQUEST_DENIED' }))
      .mockResolvedValueOnce(response({ status: 'ZERO_RESULTS', predictions: [] }));
    const provider = new GoogleMapsProvider('key', fetcher);
    await expect(provider.places('pat')).rejects.toMatchObject({
      code: 'MAP_PROVIDER_AUTHORIZATION',
    });
    expect(await provider.places('pat')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('bounds timeout attempts and reports failure without an invented route', async () => {
    const fetcher = vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Timeout', 'AbortError')),
            { once: true },
          );
        }),
    ) as unknown as typeof fetch;
    const provider = new GoogleMapsProvider('key', fetcher);
    await expect(
      provider.calculateRoute({ latitude: 25, longitude: 85 }, { latitude: 26, longitude: 85 }),
    ).rejects.toMatchObject({ code: 'MAP_PROVIDER_TIMEOUT' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('rejects malformed JSON bodies without returning not-found', async () => {
    const provider = new GoogleMapsProvider('key', vi.fn().mockResolvedValue(response(null)));
    await expect(provider.geocode('patna')).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
  });
  it('does not fetch or count an attempt when durable navigation reservation is rejected', async () => {
    const fetcher = vi.fn(),
      actual = vi.fn(),
      logger = vi.fn();
    const provider = new GoogleMapsProvider('key', fetcher, Date.now, logger);
    await expect(
      provider.calculateRoute(
        { latitude: 25, longitude: 85 },
        { latitude: 26, longitude: 85 },
        {
          beforeExternalRequest: async () => {
            throw new (await import('../../../common/errors/app-error.js')).AppError(
              'MAP_RIDE_STATE_CHANGED',
              'Changed',
              409,
            );
          },
          onExternalRequest: actual,
        },
      ),
    ).rejects.toMatchObject({ code: 'MAP_RIDE_STATE_CHANGED' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(actual).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalledWith('map_provider_request', expect.anything());
  });
  it('rejects a structurally empty HTTP success rather than reporting no location', async () => {
    const provider = new GoogleMapsProvider('key', vi.fn().mockResolvedValue(response({})));
    await expect(provider.geocode('patna')).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
  });
});

describe('Google provider nested payload integrity', () => {
  it.each([
    { routes: [] },
    { routes: [{ legs: [] }] },
    { routes: [{ legs: [{ distance: { value: 1 }, duration: { value: -1 } }] }] },
    {
      routes: [
        {
          legs: [{ distance: { value: 1 }, duration: { value: 1 } }],
          overview_polyline: { points: '?' },
        },
      ],
    },
  ])('rejects malformed successful route %#', async (body) => {
    const logger = vi.fn();
    const provider = new GoogleMapsProvider(
      'private-key',
      vi.fn().mockResolvedValue(response(body)),
      Date.now,
      logger,
    );
    await expect(
      provider.calculateRoute({ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }),
    ).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
    expect(logger).toHaveBeenCalledWith(
      'map_provider_request',
      expect.objectContaining({ success: false }),
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain('private-key');
    expect(JSON.stringify(logger.mock.calls)).not.toContain('maps.googleapis.com');
  });
  it.each([
    { results: [] },
    { results: [{}] },
    { results: [{ geometry: { location: { lat: 91, lng: 0 } } }] },
  ])('rejects malformed geocode %#', async (body) => {
    await expect(
      new GoogleMapsProvider('key', vi.fn().mockResolvedValue(response(body))).geocode('patna'),
    ).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
  });
  it('rejects malformed search suggestions instead of dropping them into empty success', async () => {
    await expect(
      new GoogleMapsProvider(
        'key',
        vi.fn().mockResolvedValue(response({ predictions: [{}] })),
      ).places('patna'),
    ).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
  });
  it('rejects truncated matrices and provider element denial', async () => {
    const point = { latitude: 1, longitude: 1 };
    await expect(
      new GoogleMapsProvider(
        'key',
        vi.fn().mockResolvedValue(response({ rows: [] })),
      ).calculateMatrix([point], point),
    ).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
    await expect(
      new GoogleMapsProvider(
        'key',
        vi
          .fn()
          .mockResolvedValue(response({ rows: [{ elements: [{ status: 'OVER_QUERY_LIMIT' }] }] })),
      ).calculateMatrix([point], point),
    ).rejects.toMatchObject({ code: 'MAP_PROVIDER_UNAVAILABLE' });
  });
  it('preserves genuine ZERO_RESULTS for geocoding and routes', async () => {
    const provider = new GoogleMapsProvider(
      'key',
      vi.fn().mockResolvedValue(response({ status: 'ZERO_RESULTS' })),
    );
    expect(await provider.geocode('patna')).toBeNull();
    expect(
      await provider.calculateRoute({ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }),
    ).toBeNull();
  });
});
