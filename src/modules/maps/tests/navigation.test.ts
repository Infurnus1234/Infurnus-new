import { describe, expect, it, vi } from 'vitest';
import { RouteRecalculationService } from '../../rides/services/route-recalculation.service.js';
import type { RouteMetadata } from '../../rides/repositories/ride.repository.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
import { mapConfig } from '../map.config.js';
const origin = { latitude: 0, longitude: 0 },
  destination = { latitude: 0, longitude: 0.01 };
const route = { distanceMeters: 1112, durationSeconds: 120, encodedPolyline: '???o}@' };
function setup() {
  let now = 20000;
  const provider: MapProvider = {
    calculateRoute: vi.fn(async (_a, _b, options) => {
      options?.onExternalRequest?.();
      return route;
    }),
    calculateMatrix: async () => [],
    geocode: async () => null,
    places: async () => [],
  };
  let saved: RouteMetadata = {
    lastCalculatedAt: 10000,
    lastOrigin: origin,
    lastValidatedOrigin: origin,
    route,
    routeState: 'ON_ROUTE',
    segment: 'destination',
    destination,
  };
  const persist = vi.fn(async (m: RouteMetadata) => {
    saved = m;
    return true;
  });
  return {
    provider,
    persist,
    service: new RouteRecalculationService(provider, () => now, mapConfig),
    get: () => saved,
    time: (v: number) => {
      now = v;
    },
  };
}
const off = (meters: number) => ({ latitude: meters / 111195, longitude: 0.005 });
describe('route-aware navigation', () => {
  it('initializes and stores a route', async () => {
    const s = setup();
    const result = await s.service.process(
      'r',
      null,
      origin,
      destination,
      'destination',
      s.persist,
    );
    expect(result).toMatchObject({
      route,
      routeState: 'ON_ROUTE',
      lastExternalRequestAt: 20000,
      routeVersion: 1,
    });
  });
  it('ignores insignificant movement without validating or calling provider', async () => {
    const s = setup();
    expect(
      await s.service.process(
        'r',
        s.get(),
        { latitude: 0, longitude: 0.00001 },
        destination,
        'destination',
        s.persist,
      ),
    ).toBeNull();
    expect(s.provider.calculateRoute).not.toHaveBeenCalled();
    expect(s.persist).not.toHaveBeenCalled();
  });
  it('updates local progress and ETA for movement along the existing route', async () => {
    const s = setup();
    const result = await s.service.process(
      'r',
      s.get(),
      { latitude: 0, longitude: 0.005 },
      destination,
      'destination',
      s.persist,
    );
    expect(result).toMatchObject({ etaSeconds: 60, routeState: 'ON_ROUTE' });
    expect(s.provider.calculateRoute).not.toHaveBeenCalled();
  });
  it('enters off-route only beyond 60m, retains state inside band and exits below 20m', async () => {
    const s = setup();
    s.provider.calculateRoute = vi.fn(async (_a, _b, opts) => {
      opts?.onExternalRequest?.();
      return null;
    });
    let result = await s.service.process(
      'r',
      s.get(),
      off(61),
      destination,
      'destination',
      s.persist,
    );
    expect(result?.routeState).toBe('OFF_ROUTE');
    s.time(21000);
    result = await s.service.process('r', s.get(), off(40), destination, 'destination', s.persist);
    expect(result?.routeState).toBe('OFF_ROUTE');
    result = await s.service.process('r', s.get(), off(19), destination, 'destination', s.persist);
    expect(result?.routeState).toBe('ON_ROUTE');
    expect(s.provider.calculateRoute).toHaveBeenCalledTimes(1);
  });
  it('retains ON_ROUTE in 20-60m band', async () => {
    const s = setup();
    expect(
      (await s.service.process('r', s.get(), off(40), destination, 'destination', s.persist))
        ?.routeState,
    ).toBe('ON_ROUTE');
    expect(s.provider.calculateRoute).not.toHaveBeenCalled();
  });
  it('blocks actual provider calls within ten seconds and allows after interval', async () => {
    const s = setup();
    s.provider.calculateRoute = vi.fn(async (_a, _b, opts) => {
      opts?.onExternalRequest?.();
      return null;
    });
    await s.service.process('r', s.get(), off(61), destination, 'destination', s.persist);
    s.time(29000);
    await s.service.process('r', s.get(), off(90), destination, 'destination', s.persist);
    expect(s.provider.calculateRoute).toHaveBeenCalledTimes(1);
    s.time(30000);
    await s.service.process('r', s.get(), off(120), destination, 'destination', s.persist);
    expect(s.provider.calculateRoute).toHaveBeenCalledTimes(2);
  });
  it('does not change last actual provider timestamp on cache-hit route', async () => {
    const s = setup();
    s.provider.calculateRoute = vi.fn(async () => route);
    const previous = { ...s.get(), lastExternalRequestAt: 0 };
    const result = await s.service.process(
      'r',
      previous,
      off(61),
      destination,
      'destination',
      s.persist,
    );
    expect(result?.lastExternalRequestAt).toBe(0);
    expect(result?.routeState).toBe('ON_ROUTE');
  });
  it('retains failed request time and the prior route without false replacement', async () => {
    const s = setup();
    s.provider.calculateRoute = vi.fn(async (_a, _b, opts) => {
      opts?.onExternalRequest?.();
      throw new Error('outage');
    });
    const result = await s.service.process(
      'r',
      s.get(),
      off(61),
      destination,
      'destination',
      s.persist,
    );
    expect(result).toMatchObject({ route, lastExternalRequestAt: 20000, routeState: 'OFF_ROUTE' });
    expect(result?.routeVersion).toBeUndefined();
  });
  it('deduplicates simultaneous reroutes for one journey', async () => {
    const s = setup();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        s.service.process('r', s.get(), off(61), destination, 'destination', s.persist),
      ),
    );
    expect(s.provider.calculateRoute).toHaveBeenCalledTimes(1);
    expect(s.persist).toHaveBeenCalledTimes(1);
  });
  it('replaces route and increments version on successful reroute', async () => {
    const s = setup();
    const next = { ...route, distanceMeters: 2000 };
    s.provider.calculateRoute = vi.fn(async (_a, _b, opts) => {
      opts?.onExternalRequest?.();
      return next;
    });
    const result = await s.service.process(
      'r',
      s.get(),
      off(61),
      destination,
      'destination',
      s.persist,
    );
    expect(result).toMatchObject({ route: next, routeState: 'ON_ROUTE', routeVersion: 1 });
  });
  it('recalculates when pickup segment changes to destination', async () => {
    const s = setup();
    const result = await s.service.process(
      'r',
      { ...s.get(), segment: 'pickup' },
      origin,
      destination,
      'destination',
      s.persist,
    );
    expect(result?.segment).toBe('destination');
    expect(s.provider.calculateRoute).toHaveBeenCalledTimes(1);
  });
  it('does not activate a route rejected at persistence and leaves prior metadata intact', async () => {
    const s = setup();
    const prior = s.get();
    const rejected = vi.fn(async () => false);
    expect(
      await s.service.process('r', prior, off(61), destination, 'destination', rejected),
    ).toBeNull();
    expect(prior.route).toEqual(route);
    expect(prior.routeVersion).toBeUndefined();
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('rejects an older accepted GPS job before any provider call or persistence', async () => {
    const s = setup();
    const prior = { ...s.get(), lastValidatedTimestamp: 20000 };
    expect(
      await s.service.process('r', prior, off(61), destination, 'destination', s.persist, 19000),
    ).toBeNull();
    expect(s.provider.calculateRoute).not.toHaveBeenCalled();
    expect(s.persist).not.toHaveBeenCalled();
  });
  it('retains a durable reservation across a restart without calling it an actual attempt', async () => {
    const s = setup();
    s.provider.calculateRoute = vi.fn(async (_a, _b, options) => {
      await options?.beforeExternalRequest?.();
      // A process can stop after reserving, before HTTP starts.
      throw new Error('Interrupted before HTTP');
    });
    const result = await s.service.process(
      'r',
      s.get(),
      off(61),
      destination,
      'destination',
      s.persist,
    );
    expect(result).toMatchObject({ externalRequestReservedAt: 20000 });
    expect(result?.lastExternalRequestAt).toBeUndefined();
    const next = new RouteRecalculationService(s.provider, () => 25000, mapConfig);
    await next.process('r', s.get(), off(100), destination, 'destination', s.persist);
    expect(s.provider.calculateRoute).toHaveBeenCalledTimes(1);
  });
});

it('does not activate a corrupt route from a direct provider adapter', async () => {
  const s = setup();
  s.provider.calculateRoute = vi.fn(async () => ({
    distanceMeters: 1,
    durationSeconds: 1,
    encodedPolyline: '?',
  }));
  const result = await s.service.process(
    'corrupt',
    null,
    origin,
    destination,
    'destination',
    s.persist,
  );
  expect(result?.route).toBeNull();
  expect(result?.routeVersion ?? 0).toBe(0);
});
it('retains valid navigation when a direct adapter returns invalid route amounts', async () => {
  const s = setup();
  s.provider.calculateRoute = vi.fn(async () => ({ distanceMeters: -1, durationSeconds: 1 }));
  const result = await s.service.process(
    'corrupt-amount',
    s.get(),
    off(61),
    destination,
    'destination',
    s.persist,
  );
  expect(result?.route).toEqual(route);
  expect(result?.routeVersion ?? 0).toBe(0);
});

it('reroutes Google navigation transiently without durable storage and expires it', async () => {
  const s = setup();
  Object.defineProperty(s.provider, 'navigationStorageAllowed', { value: false });
  const first = await s.service.process(
    'transient',
    null,
    origin,
    destination,
    'pickup',
    s.persist,
  );
  expect(first).toMatchObject({ segment: 'pickup', routeVersion: 1 });
  expect(s.persist).not.toHaveBeenCalled();
  expect(s.service.transientMetadata('transient')).toMatchObject({ route });
  await s.service.process(
    'transient',
    null,
    { latitude: 0, longitude: 0.005 },
    destination,
    'pickup',
    s.persist,
  );
  expect(s.provider.calculateRoute).toHaveBeenCalledTimes(1);
  s.time(40000);
  const next = await s.service.process(
    'transient',
    null,
    off(100),
    { latitude: 0, longitude: 0.02 },
    'destination',
    s.persist,
  );
  expect(next).toMatchObject({ segment: 'destination', routeVersion: 2 });
  expect(s.persist).not.toHaveBeenCalled();
  s.time(40000 + mapConfig.refreshMs);
  expect(s.service.transientMetadata('transient')).toBeNull();
});
it('completion invalidates in-flight transient route work without reactivating geometry', async () => {
  const s = setup();
  Object.defineProperty(s.provider, 'navigationStorageAllowed', { value: false });
  let resolve!: (value: typeof route) => void;
  s.provider.calculateRoute = vi.fn(
    () =>
      new Promise<typeof route>((done) => {
        resolve = done;
      }),
  );
  const pending = s.service.process('finished', null, origin, destination, 'pickup', s.persist);
  s.service.clear('finished');
  resolve(route);
  expect(await pending).toBeNull();
  expect(s.service.transientMetadata('finished')).toBeNull();
  expect(s.persist).not.toHaveBeenCalled();
});
