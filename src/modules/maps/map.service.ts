import { env } from '../../config/env.js';
import { createHash } from 'node:crypto';
import { serviceArea, type ServiceAreaGate } from './service-area.js';
import { AppError } from '../../common/errors/app-error.js';
import type {
  Coordinates,
  MapProvider,
  MapRequestOptions,
  PlaceSuggestion,
  ReverseGeocodeResult,
  RouteResult,
} from '../rides/providers/map.provider.js';
import { validRouteResult, geographicDistance, validateCoordinates } from './geometry.js';
import { mapConfig, type MapConfig } from './map.config.js';
import type { MapCache } from './map.cache.js';

export function normalizeText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-IN');
}
export function rankPlaces(query: string, places: PlaceSuggestion[], region: string) {
  const q = normalizeText(query),
    r = normalizeText(region);
  const score = (p: PlaceSuggestion) => {
    const full = normalizeText(p.description),
      name = full.split(',')[0]!.trim();
    return (
      (name === q ? 1000 : name.startsWith(q) ? 500 : full.includes(q) ? 100 : 0) +
      (full.split(',').some((part) => part.trim() === r) ? 2000 : 0)
    );
  };
  return [...places]
    .map((p, index) => ({ p, index }))
    .sort((a, b) => score(b.p) - score(a.p) || a.index - b.index)
    .map(({ p }) => p);
}

type Metric = {
  requests: number;
  hits: number;
  misses: number;
  deduplicated: number;
  external: number;
  success: number;
  failed: number;
  totalMs: number;
};
const emptyMetric = (): Metric => ({
  requests: 0,
  hits: 0,
  misses: 0,
  deduplicated: 0,
  external: 0,
  success: 0,
  failed: 0,
  totalMs: 0,
});
export class CommonMapService implements MapProvider {
  readonly providerName: string;
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly metrics = new Map<string, Metric>();
  private readonly popularity = new Map<string, number>();
  private cacheUnavailableUntil = 0;
  private readonly hourly = new Map<number, number>();
  constructor(
    private readonly provider: MapProvider,
    private readonly cache?: MapCache,
    readonly config: MapConfig = mapConfig,
    private readonly now: () => number = Date.now,
    private readonly log: (event: Record<string, unknown>) => void = (e) =>
      console.info(JSON.stringify(e)),
    private readonly area: ServiceAreaGate = serviceArea,
  ) {
    this.providerName = provider.providerName ?? 'configured';
  }
  get navigationStorageAllowed() {
    // Redis cache permission does not authorize indefinite ride JSONB retention.
    // Keep durable Google navigation disabled until an approved retention/purge policy exists.
    return this.providerName !== 'google';
  }
  assertServiceArea(points: Coordinates[]) {
    return this.area.assertSupported(points);
  }
  hourlyUsage() {
    return Object.fromEntries(
      [...this.hourly].map(([hour, count]) => [new Date(hour * 3600000).toISOString(), count]),
    );
  }

  forSource(source: NonNullable<MapRequestOptions['source']>): MapProvider {
    return {
      providerName: this.providerName,
      navigationStorageAllowed: this.navigationStorageAllowed,
      calculateRoute: (a, b, options) => this.calculateRoute(a, b, { ...options, source }),
      calculateMatrix: (a, b, options) => this.calculateMatrix(a, b, { ...options, source }),
      geocode: (address) => this.geocode(address, { source }),
      reverseGeocode: (point) => this.reverseGeocode(point, { source }),
      places: (query) => this.places(query, { source }),
    };
  }
  private point(p: Coordinates, precision = 5) {
    validateCoordinates(p);
    return {
      latitude: Number(p.latitude.toFixed(precision)),
      longitude: Number(p.longitude.toFixed(precision)),
    };
  }
  private key(kind: string, args: unknown) {
    return `map:v1:${this.providerName}:${kind}:${createHash('sha256')
      .update(JSON.stringify([this.config.region, this.config.country, args]))
      .digest('hex')}`;
  }
  private async cached<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (!this.cache || this.now() < this.cacheUnavailableUntil) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Cache timeout')), this.config.cacheTimeoutMs);
        }),
      ]);
    } catch {
      this.cacheUnavailableUntil = this.now() + 1000;
      this.log({ event: 'map_cache_unavailable', provider: this.providerName });
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private valid(kind: string, value: unknown): boolean {
    if (value === null) return kind === 'geocode' || kind === 'reverse' || kind === 'route';
    const point = (v: unknown) => {
      try {
        validateCoordinates(v as Coordinates);
        return true;
      } catch {
        return false;
      }
    };
    const route = validRouteResult;
    if (kind === 'geocode') return point(value);
    if (kind === 'route') return route(value);
    if (kind === 'reverse') {
      const r = value as ReverseGeocodeResult;
      return typeof r.address === 'string' && r.address.length > 0 && point(r.coordinates);
    }
    if (kind === 'search')
      return (
        Array.isArray(value) &&
        value.every((p) => p && typeof p.placeId === 'string' && typeof p.description === 'string')
      );
    if (kind === 'matrix')
      return (
        Array.isArray(value) &&
        value.every((r) => r && point(r.origin) && (r.route === null || route(r.route)))
      );
    return false;
  }
  private ttl(kind: string, requested: number) {
    // Google's agreement does not generally permit storing descriptions/routes.
    return this.providerName === 'google' &&
      !this.config.providerContentCaching &&
      kind !== 'geocode'
      ? 0
      : requested;
  }
  snapshot() {
    return Object.fromEntries(
      [...this.metrics].map(([k, v]) => [
        k,
        { ...v, averageResponseMs: v.success + v.failed ? v.totalMs / (v.success + v.failed) : 0 },
      ]),
    );
  }
  private async request<T>(
    kind: string,
    args: unknown,
    ttl: number,
    load: (callOptions: MapRequestOptions) => Promise<T>,
    options: MapRequestOptions = {},
  ): Promise<T> {
    const source = options.source ?? 'USER',
      metricKey = `${source}:${kind}`;
    const metric = this.metrics.get(metricKey) ?? emptyMetric();
    this.metrics.set(metricKey, metric);
    metric.requests++;
    const key = this.key(kind, args),
      effectiveTtl = this.ttl(kind, ttl);
    const current = this.pending.get(key);
    if (current) {
      metric.deduplicated++;
      const started = this.now();
      try {
        const result = (await current) as T;
        metric.success++;
        return result;
      } catch (error) {
        metric.failed++;
        throw error;
      } finally {
        metric.totalMs += this.now() - started;
      }
    }
    if (this.pending.size >= 1000)
      throw new AppError('MAP_CAPACITY_EXCEEDED', 'Map service is busy; try again', 503);
    const work = (async () => {
      const started = this.now();
      let token: string | null | undefined;
      let hit = false;
      let success = false;
      try {
        const raw = effectiveTtl ? await this.cached(() => this.cache!.get(key)) : undefined;
        if (raw) {
          try {
            const value = JSON.parse(raw) as T;
            if (!this.valid(kind, value)) throw new Error('Invalid map cache');
            metric.success++;
            metric.hits++;
            hit = true;
            success = true;
            return value;
          } catch {
            /* bad cache is a miss */
          }
        }
        metric.misses++;
        if (effectiveTtl) {
          token = await this.cached(() => this.cache!.lock(`${key}:lock`, this.config.lockMs));
          if (token) {
            // Another owner can publish and unlock after our initial cache read.
            const published = await this.cached(() => this.cache!.get(key));
            if (published) {
              try {
                const value = JSON.parse(published) as T;
                if (!this.valid(kind, value)) throw new Error('Invalid map cache');
                metric.hits++;
                metric.success++;
                hit = true;
                success = true;
                return value;
              } catch {
                /* reload corrupt data */
              }
            }
          }
          if (token === null) {
            metric.deduplicated++;
            const deadline = Date.now() + this.config.lockMs;
            while (Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 50));
              const raw = await this.cached(() => this.cache!.get(key));
              if (raw) {
                try {
                  const value = JSON.parse(raw) as T;
                  if (!this.valid(kind, value)) throw new Error('Invalid map cache');
                  metric.hits++;
                  metric.success++;
                  hit = true;
                  success = true;
                  return value;
                } catch {
                  /* corrupt content is a miss */
                }
              }
              // Redis outage is an optimization failure, not a provider failure.
              if (this.now() < this.cacheUnavailableUntil) {
                token = undefined;
                break;
              }
              token = await this.cached(() => this.cache!.lock(key + ':lock', this.config.lockMs));
              if (token !== null) {
                if (token) {
                  // The former owner may have published between our read and acquisition.
                  const published = await this.cached(() => this.cache!.get(key));
                  if (published) {
                    try {
                      const value = JSON.parse(published) as T;
                      if (!this.valid(kind, value)) throw new Error('Invalid map cache');
                      metric.hits++;
                      metric.success++;
                      hit = true;
                      success = true;
                      return value;
                    } catch {
                      /* reload corrupt data */
                    }
                  }
                }
                break;
              }
            }
            if (token === null)
              throw new AppError(
                'MAP_REQUEST_PENDING',
                'An identical map request is still running; try again',
                503,
              );
          }
        }
        const result = await load({
          ...options,
          source,
          onExternalRequest: () => {
            metric.external++;
            const hour = Math.floor(this.now() / 3600000);
            this.hourly.set(hour, (this.hourly.get(hour) ?? 0) + 1);
            for (const bucket of this.hourly.keys())
              if (bucket < hour - 47) this.hourly.delete(bucket);
            options.onExternalRequest?.();
          },
        });
        if (!this.valid(kind, result))
          throw new AppError('MAP_PROVIDER_INVALID', 'Map provider returned invalid data', 503);
        if (result !== null && !(Array.isArray(result) && result.length === 0) && effectiveTtl)
          await this.cached<void | boolean>(() =>
            token && this.cache!.setIfLocked
              ? this.cache!.setIfLocked(key, JSON.stringify(result), effectiveTtl, token)
              : this.cache!.set(key, JSON.stringify(result), effectiveTtl),
          );
        metric.success++;
        success = true;
        return result;
      } catch (error) {
        metric.failed++;
        if (error instanceof AppError) throw error;
        throw new AppError(
          'MAP_PROVIDER_UNAVAILABLE',
          'Map provider is temporarily unavailable',
          503,
        );
      } finally {
        if (token) await this.cached(() => this.cache!.unlock(`${key}:lock`, token!));
        const duration = this.now() - started;
        metric.totalMs += duration;
        this.log({
          event: 'map_request',
          provider: this.providerName,
          apiType: kind,
          module: source,
          requestType: kind,
          timestamp: new Date().toISOString(),
          cache: hit ? 'hit' : 'miss',
          success,
          responseTimeMs: duration,
        });
      }
    })();
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      if (this.pending.get(key) === work) this.pending.delete(key);
    }
  }
  async places(query: string, options: MapRequestOptions = {}): Promise<PlaceSuggestion[]> {
    await this.area.assertSupported([]);
    const q = normalizeText(query);
    if (!q.length) return [];
    if (q.length > 200) throw new AppError('MAP_INPUT_INVALID', 'Search query is too long', 400);
    const key = this.key('search', q),
      count = (this.popularity.get(key) ?? 0) + 1;
    if (this.popularity.size >= 1000) this.popularity.delete(this.popularity.keys().next().value!);
    this.popularity.set(key, count);
    const results = await this.request(
      'search',
      q,
      count >= 3 ? this.config.popularTtl : this.config.searchTtl,
      async (callOptions) => {
        let bias: Coordinates | null = null;
        if (this.providerName === 'google')
          bias = await this.geocode(this.config.region, options).catch(() => null);
        return this.provider.places(q, { ...callOptions, ...(bias ? { locationBias: bias } : {}) });
      },
      options,
    );
    const unique = [
      ...new Map(
        results
          .filter((p) => typeof p.placeId === 'string' && typeof p.description === 'string')
          .map((p) => [p.placeId, p]),
      ).values(),
    ];
    return rankPlaces(q, unique, this.config.region).slice(0, 10);
  }
  async geocode(address: string, options: MapRequestOptions = {}): Promise<Coordinates | null> {
    await this.area.assertSupported([]);
    const value = normalizeText(address);
    if (value.length < 3 || value.length > 500)
      throw new AppError('MAP_INPUT_INVALID', 'A valid address is required', 400);
    return this.request(
      'geocode',
      value,
      this.config.geocodeTtl,
      async (callOptions) => {
        const p = await this.provider.geocode(value, callOptions);
        return p;
      },
      options,
    );
  }
  async reverseGeocode(
    point: Coordinates,
    options: MapRequestOptions = {},
  ): Promise<ReverseGeocodeResult | null> {
    await this.area.assertSupported([point]);
    const p = this.point(point, this.config.reversePrecision);
    if (!this.provider.reverseGeocode)
      throw new AppError('MAP_OPERATION_UNAVAILABLE', 'Reverse geocoding is not configured', 503);
    return this.request(
      'reverse',
      p,
      this.config.reverseTtl,
      (callOptions) => this.provider.reverseGeocode!(p, callOptions),
      options,
    );
  }
  async calculateRoute(
    origin: Coordinates,
    destination: Coordinates,
    options: MapRequestOptions = {},
  ): Promise<RouteResult | null> {
    await this.area.assertSupported([origin, destination]);
    const a = this.point(origin),
      b = this.point(destination),
      mode = options.mode ?? 'driving',
      avoidTolls = options.avoidTolls ?? false;
    return this.request(
      'route',
      { a, b, mode, avoidTolls },
      this.config.routeTtl,
      async (callOptions) => {
        const result = await this.provider.calculateRoute(a, b, {
          ...callOptions,
          mode,
          avoidTolls,
        });
        if (
          result &&
          (!Number.isFinite(result.distanceMeters) ||
            result.distanceMeters < 0 ||
            !Number.isFinite(result.durationSeconds) ||
            result.durationSeconds < 0)
        )
          throw new AppError(
            'MAP_PROVIDER_INVALID',
            'Map provider returned invalid route data',
            503,
          );
        return result;
      },
      options,
    );
  }
  async calculateMatrix(
    origins: Coordinates[],
    destination: Coordinates,
    options: MapRequestOptions = {},
  ) {
    if (origins.length > env.MAX_DRIVER_MATCH_CANDIDATES)
      throw new AppError('MAP_INPUT_INVALID', 'Too many matrix origins', 400);
    await this.area.assertSupported([...origins, destination]);
    const a = origins.map((p) => this.point(p)),
      b = this.point(destination);
    const results = await this.request(
      'matrix',
      { a, b },
      this.config.distanceTtl,
      (callOptions) => this.provider.calculateMatrix(a, b, callOptions),
      { ...options, source: options.source ?? 'RIDE' },
    );
    return results.map((result, index) => ({ ...result, origin: origins[index] ?? result.origin }));
  }
  async distance(
    origin: Coordinates,
    destination: Coordinates,
    kind: 'geographic' | 'road',
    options: MapRequestOptions = {},
  ) {
    await this.area.assertSupported([origin, destination]);
    if (kind === 'geographic')
      return {
        distanceMeters: geographicDistance(origin, destination),
        source: 'geographic_local',
      };
    const route = await this.calculateRoute(origin, destination, options);
    if (!route) throw new AppError('MAP_ROUTE_UNAVAILABLE', 'No road route is available', 503);
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      source: 'road_provider',
    };
  }
}
