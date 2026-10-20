import { describe, expect, it, vi } from 'vitest';
import { CommonMapService, normalizeText, rankPlaces } from '../map.service.js';
import { mapConfig } from '../map.config.js';
import type { MapCache } from '../map.cache.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
import { decodePolyline, geographicDistance, routeProgress } from '../geometry.js';

class Cache implements MapCache {
  readonly values = new Map<string, { value: string; expires: number }>();
  readonly locks = new Map<string, string>();
  time = 0;
  async get(k: string) {
    const r = this.values.get(k);
    return r && r.expires > this.time ? r.value : null;
  }
  async set(k: string, v: string, ttl: number) {
    this.values.set(k, { value: v, expires: this.time + ttl * 1000 });
  }
  async lock(k: string) {
    if (this.locks.has(k)) return null;
    this.locks.set(k, 'token');
    return 'token';
  }
  async unlock(k: string, t: string) {
    if (this.locks.get(k) === t) this.locks.delete(k);
  }
}
function provider(): MapProvider {
  return {
    providerName: 'fixture',
    calculateRoute: vi.fn(async () => ({ distanceMeters: 1000, durationSeconds: 60 })),
    calculateMatrix: vi.fn(async (origins: { latitude: number; longitude: number }[]) =>
      origins.map((origin) => ({ origin, route: null })),
    ),
    geocode: vi.fn(async () => ({ latitude: 25.5941, longitude: 85.1376 })),
    reverseGeocode: vi.fn(async (point) => ({ coordinates: point, address: 'Provider address' })),
    places: vi.fn(async () => [
      { placeId: 'provider-patna', description: 'Patna, Bihar, India' },
      { placeId: 'provider-junction', description: 'Patna Junction, Bihar, India' },
      { placeId: 'provider-other', description: 'Patna, Other region' },
    ]),
  };
}
const a = { latitude: 25.5941, longitude: 85.1376 },
  b = { latitude: 25.6, longitude: 85.14 };
const config = { ...mapConfig, providerContentCaching: true, reversePrecision: 4 };
const service = (p = provider(), c: MapCache = new Cache()) =>
  new CommonMapService(p, c, config, Date.now, () => {});
describe('CommonMapService', () => {
  it('reuses a result published between the initial cache miss and lock acquisition', async () => {
    const p = provider(),
      c = new Cache();
    c.get = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(JSON.stringify(a));
    expect(await service(p, c).geocode('patna')).toEqual(a);
    expect(p.geocode).not.toHaveBeenCalled();
    expect(c.locks.size).toBe(0);
  });
  it('keeps short partial queries distinct on cache miss and hit', async () => {
    const p = provider(),
      s = service(p);
    for (const query of ['P', 'PA', 'PAT', 'M', 'MU', 'MUJ']) {
      expect(await s.places(query)).not.toEqual([]);
      await s.places(` ${query.toLowerCase()} `);
    }
    expect(p.places).toHaveBeenCalledTimes(6);
    expect(vi.mocked(p.places).mock.calls.map(([query]) => query)).toEqual([
      'p',
      'pa',
      'pat',
      'm',
      'mu',
      'muj',
    ]);
  });
  it('prioritizes provider Bihar predictions over an out-of-state exact match', () => {
    expect(
      rankPlaces(
        'pat',
        [
          { placeId: 'outside', description: 'Pat, Gujarat, India' },
          { placeId: 'inside', description: 'Patna, Bihar, India' },
        ],
        'Bihar',
      )[0]!.placeId,
    ).toBe('inside');
  });
  it('normalizes formatting without altering words', () => {
    expect(normalizeText('  PATNA   Junction ')).toBe('patna junction');
  });
  it('ranks exact then prefix and Bihar while preserving provider ties', () => {
    const results = rankPlaces(
      'pat',
      [
        { placeId: 'other', description: 'Patan, Gujarat' },
        { placeId: 'bihar', description: 'Patna, Bihar' },
      ],
      'Bihar',
    );
    expect(results[0]!.placeId).toBe('bihar');
  });
  it('returns provider-backed pat results, exact/prefix results, and normalized cache hits', async () => {
    const p = provider(),
      s = service(p);
    const results = await s.places('PAT');
    expect(results[0]!.description).toBe('Patna, Bihar, India');
    await s.places(' pat ');
    expect(p.places).toHaveBeenCalledTimes(1);
    expect((await s.places('patna junction'))[0]!.placeId).toBe('provider-junction');
  });
  it('deduplicates concurrent search misses', async () => {
    const p = provider(),
      s = service(p);
    await Promise.all([s.places('pat'), s.places('PAT'), s.places(' pat ')]);
    expect(p.places).toHaveBeenCalledTimes(1);
  });
  it('does not suppress different simultaneous queries', async () => {
    const p = provider(),
      s = service(p);
    await Promise.all([s.places('pat'), s.places('patna junction')]);
    expect(p.places).toHaveBeenCalledTimes(2);
  });
  it('promotes repeated popular query TTL after cache expiry without invented places', async () => {
    const p = provider(),
      c = new Cache(),
      s = service(p, c);
    await s.places('pat');
    await s.places('pat');
    c.time = 400000;
    await s.places('pat');
    expect([...c.values.values()][0]!.expires).toBe(c.time + config.popularTtl * 1000);
  });
  it('geocodes normalized addresses once and reuses coordinates', async () => {
    const p = provider(),
      s = service(p);
    expect(await s.geocode(' Patna Junction ')).toEqual(a);
    await s.geocode('patna junction');
    expect(p.geocode).toHaveBeenCalledTimes(1);
  });
  it('deduplicates concurrent geocoding', async () => {
    const p = provider(),
      s = service(p);
    await Promise.all([s.geocode('patna'), s.geocode('PATNA')]);
    expect(p.geocode).toHaveBeenCalledTimes(1);
  });
  it('rounds reverse geocoding lookup coordinates and reuses cache', async () => {
    const p = provider(),
      s = service(p);
    await s.reverseGeocode({ latitude: 25.59411, longitude: 85.13761 });
    await s.reverseGeocode({ latitude: 25.59412, longitude: 85.13762 });
    expect(p.reverseGeocode).toHaveBeenCalledTimes(1);
  });
  it('coalesces routes, normalizes coordinates, and isolates modes/options', async () => {
    const p = provider(),
      s = service(p);
    await Promise.all([s.calculateRoute(a, b), s.calculateRoute(a, b)]);
    await s.calculateRoute(a, b);
    expect(p.calculateRoute).toHaveBeenCalledTimes(1);
    await s.calculateRoute(a, b, { mode: 'walking' });
    await s.calculateRoute(a, b, { avoidTolls: true });
    expect(p.calculateRoute).toHaveBeenCalledTimes(3);
  });
  it('local geographic distance never calls external routing', async () => {
    const p = provider(),
      s = service(p);
    const result = await s.distance(a, b, 'geographic');
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(p.calculateRoute).not.toHaveBeenCalled();
  });
  it('road distance and initial ETA reuse route cache', async () => {
    const p = provider(),
      s = service(p);
    expect(await s.distance(a, b, 'road')).toMatchObject({
      distanceMeters: 1000,
      durationSeconds: 60,
    });
    await s.calculateRoute(a, b);
    expect(p.calculateRoute).toHaveBeenCalledTimes(1);
  });
  it.each([
    { latitude: NaN, longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: 181 },
  ])('rejects invalid coordinates %j', async (point) => {
    await expect(service().calculateRoute(point, b)).rejects.toMatchObject({
      code: 'MAP_INPUT_INVALID',
    });
  });
  it('rejects malformed provider routes rather than zeroing their amount', async () => {
    const p = provider();
    p.calculateRoute = vi.fn(async () => ({ distanceMeters: NaN, durationSeconds: 60 }));
    await expect(service(p).calculateRoute(a, b)).rejects.toMatchObject({
      code: 'MAP_PROVIDER_INVALID',
    });
  });
  it('falls back quickly when Redis fails', async () => {
    const p = provider(),
      c = new Cache();
    c.get = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await service(p, c).geocode('patna')).toEqual(a);
  });
  it('handles provider failure and releases in-flight work for retry', async () => {
    const p = provider();
    p.geocode = vi.fn().mockRejectedValueOnce(new Error('outage')).mockResolvedValue(a);
    const s = service(p);
    await expect(s.geocode('patna')).rejects.toMatchObject({ code: 'MAP_PROVIDER_UNAVAILABLE' });
    expect(await s.geocode('patna')).toEqual(a);
  });
  it('does not cache provider nulls or empty failed results', async () => {
    const p = provider();
    p.geocode = vi.fn(async () => null);
    const s = service(p);
    await s.geocode('patna');
    await s.geocode('patna');
    expect(p.geocode).toHaveBeenCalledTimes(2);
  });
  it('respects Google content caching policy while allowing geocode coordinates', async () => {
    const p = provider();
    Object.assign(p, { providerName: 'google' });
    const s = new CommonMapService(
      p,
      new Cache(),
      { ...config, providerContentCaching: false },
      Date.now,
      () => {},
    );
    await s.calculateRoute(a, b);
    await s.calculateRoute(a, b);
    expect(p.calculateRoute).toHaveBeenCalledTimes(2);
    await s.geocode('patna');
    await s.geocode('patna');
    expect(p.geocode).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed reverse and matrix provider data before caching', async () => {
    const p = provider();
    p.reverseGeocode = vi.fn(async () => ({
      address: 'Invalid',
      coordinates: { latitude: NaN, longitude: 0 },
    }));
    p.calculateMatrix = vi.fn(async () => [
      { origin: a, route: { distanceMeters: -1, durationSeconds: 60 } },
    ]);
    const s = service(p);
    await expect(s.reverseGeocode(a)).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
    await expect(s.calculateMatrix([a], b)).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
  });
  it('treats a malformed cached route as a miss rather than an available zero fare', async () => {
    const p = provider(),
      c = new Cache(),
      s = service(p, c);
    await s.calculateRoute(a, b);
    const entry = [...c.values.values()][0]!;
    entry.value = '{"distanceMeters":null,"durationSeconds":60}';
    expect(await s.calculateRoute(a, b)).toMatchObject({ distanceMeters: 1000 });
    expect(p.calculateRoute).toHaveBeenCalledTimes(2);
  });
  it('records actual requests/cache/dedup metrics without query or coordinates', async () => {
    const p = provider();
    p.calculateRoute = vi.fn(async (_a, _b, opts) => {
      opts?.onExternalRequest?.();
      return { distanceMeters: 1000, durationSeconds: 60 };
    });
    const log = vi.fn();
    const s = new CommonMapService(p, new Cache(), config, Date.now, log);
    await s.calculateRoute(a, b, { source: 'RIDE' });
    await s.calculateRoute(a, b, { source: 'RIDE' });
    expect(s.snapshot()['RIDE:route']).toMatchObject({ requests: 2, hits: 1, external: 1 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('25.5941');
  });
  it('recovers a failed lock owner instead of waiting out the entire lease', async () => {
    const p = provider(),
      c = new Cache();
    c.lock = vi.fn().mockResolvedValueOnce(null).mockResolvedValue('new-owner');
    const result = await service(p, c).geocode('patna');
    expect(result).toEqual(a);
    expect(c.lock).toHaveBeenCalledTimes(2);
    expect(p.geocode).toHaveBeenCalledTimes(1);
  });
  it('continues provider work when Redis fails during a coordinated wait', async () => {
    const p = provider(),
      c = new Cache();
    c.lock = vi.fn().mockResolvedValue(null);
    c.get = vi.fn().mockResolvedValueOnce(null).mockRejectedValue(new Error('disconnected'));
    expect(await service(p, c).geocode('patna')).toEqual(a);
    expect(p.geocode).toHaveBeenCalledTimes(1);
  });
  it('counts deduplicated followers and preserves source attribution for matrices', async () => {
    const p = provider(),
      s = service(p);
    await Promise.all([s.geocode('patna'), s.geocode('PATNA')]);
    expect(s.snapshot()['USER:geocode']).toMatchObject({
      requests: 2,
      success: 2,
      deduplicated: 1,
    });
    await s.forSource('LOGISTICS').calculateMatrix([a], b);
    expect(s.snapshot()['LOGISTICS:matrix']).toMatchObject({ requests: 1, success: 1 });
  });
  it('counts failed deduplicated followers', async () => {
    const p = provider(),
      s = service(p);
    p.geocode = vi.fn(async () => {
      throw new Error('outage');
    });
    await Promise.allSettled([s.geocode('patna'), s.geocode('PATNA')]);
    expect(s.snapshot()['USER:geocode']).toMatchObject({ requests: 2, failed: 2 });
  });
  it('rejects malformed nonempty route geometry and null collection results', async () => {
    const p = provider(),
      s = service(p);
    p.calculateRoute = vi.fn(async () => ({
      distanceMeters: 1000,
      durationSeconds: 60,
      encodedPolyline: 'bad!',
    }));
    await expect(s.calculateRoute(a, b)).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
    p.places = vi.fn(async () => null as never);
    await expect(s.places('pat')).rejects.toMatchObject({ code: 'MAP_PROVIDER_INVALID' });
  });
  it('deduplicates Google searches without persistent content caching', async () => {
    const p = provider();
    Object.assign(p, { providerName: 'google' });
    const c = new Cache(),
      s = new CommonMapService(
        p,
        c,
        { ...config, providerContentCaching: false },
        Date.now,
        () => {},
      );
    await Promise.all([s.places('pat'), s.places('PAT')]);
    expect(p.places).toHaveBeenCalledTimes(1);
    await s.places('pat');
    expect(p.places).toHaveBeenCalledTimes(2);
    expect([...c.values.keys()].some((k) => k.includes(':search:'))).toBe(false);
  });
  it.each([
    'pat',
    'patn',
    'patna',
    'Patna Railway Station',
    'Patna Airport',
    'Gaya',
    'Muzaffarpur',
    'Bhagalpur',
    'Darbhanga',
    'Bihar Sharif',
  ])('passes Bihar query %s through normalization without invented expansion', async (query) => {
    const p = provider(),
      s = service(p);
    await s.places(query);
    expect(p.places).toHaveBeenCalledWith(normalizeText(query), expect.anything());
  });
});
describe('local route geometry', () => {
  it('decodes known polyline and projects remaining distance', () => {
    const points = decodePolyline('???o}@');
    expect(points).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.01 },
    ]);
    expect(routeProgress({ latitude: 0, longitude: 0.005 }, points)).toMatchObject({
      deviationMeters: 0,
      remainingFraction: 0.5,
    });
  });
  it('rejects malformed route geometry', () => {
    expect(decodePolyline('~~~')).toEqual([]);
  });
  it('returns zero distance for identical geographic points', () => {
    expect(geographicDistance(a, a)).toBe(0);
  });
});

it('rejects an oversized matrix before provider or cache work', async () => {
  const provider = {
    calculateRoute: vi.fn(),
    calculateMatrix: vi.fn(),
    geocode: vi.fn(),
    places: vi.fn(),
  };
  const maps = new CommonMapService(provider);
  await expect(
    maps.calculateMatrix(
      Array.from({ length: 26 }, () => ({ latitude: 0, longitude: 0 })),
      { latitude: 0, longitude: 0 },
    ),
  ).rejects.toMatchObject({ code: 'MAP_INPUT_INVALID' });
  expect(provider.calculateMatrix).not.toHaveBeenCalled();
});
