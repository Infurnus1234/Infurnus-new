import { AppError } from '../../../common/errors/app-error.js';
import { env } from '../../../config/env.js';
import type { Coordinates, MapProvider, RouteResult } from '../providers/map.provider.js';
import type { RouteMetadata } from '../repositories/ride.repository.js';
import {
  decodePolyline,
  geographicDistance,
  routeProgress,
  validRouteResult,
} from '../../maps/geometry.js';
import { mapConfig, type MapConfig } from '../../maps/map.config.js';

export class RouteRecalculationService {
  private readonly pending = new Map<string, Promise<RouteMetadata | null>>();
  private readonly cancelled = new Set<string>();
  private readonly transient = new Map<
    string,
    { metadata: RouteMetadata; expires: number; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private readonly provider: MapProvider,
    private readonly clock: () => number = Date.now,
    private readonly config: MapConfig = mapConfig,
  ) {}

  // Retained for existing explicit callers; active navigation uses process below.
  shouldRecalculate(
    lastCalculatedAt: number | null,
    lastOrigin: Coordinates | null,
    origin: Coordinates,
  ) {
    if (lastCalculatedAt === null || lastOrigin === null) return true;
    return (
      (this.clock() - lastCalculatedAt) / 1000 >= env.GOOGLE_ROUTE_RECALCULATION_INTERVAL_SECONDS ||
      geographicDistance(lastOrigin, origin) >= env.GOOGLE_ROUTE_RECALCULATION_DISTANCE_METERS
    );
  }
  calculate(origin: Coordinates, destination: Coordinates): Promise<RouteResult | null> {
    return this.provider.calculateRoute(origin, destination);
  }

  transientMetadata(id: string): RouteMetadata | null {
    const value = this.transient.get(id);
    if (!value) return null;
    if (value.expires <= this.clock()) {
      this.clear(id);
      return null;
    }
    return value.metadata;
  }
  clear(id: string) {
    if (this.pending.has(id)) this.cancelled.add(id);
    this.eraseTransient(id);
  }
  private eraseTransient(id: string) {
    const value = this.transient.get(id);
    if (value) clearTimeout(value.timer);
    this.transient.delete(id);
  }

  process(
    id: string,
    metadata: RouteMetadata | null,
    origin: Coordinates,
    destination: Coordinates,
    segment: 'pickup' | 'destination',
    persist: (m: RouteMetadata) => Promise<boolean>,
    recordedAt?: number,
  ): Promise<RouteMetadata | null> {
    // Google route geometry is transient only: do not write it to ride JSONB.
    if (this.provider.navigationStorageAllowed === false) {
      metadata = this.transientMetadata(id);
      if (!metadata && this.transient.size >= 1000) return Promise.resolve(null);
      persist = async (next) => {
        if (this.cancelled.has(id)) return false;
        this.eraseTransient(id);
        const ttl = this.config.refreshMs;
        const timer = setTimeout(() => this.clear(id), ttl);
        timer.unref();
        this.transient.set(id, { metadata: next, expires: this.clock() + ttl, timer });
        return true;
      };
    }
    const current = this.pending.get(id);
    if (current) return current;
    if (this.pending.size >= 1000) return Promise.resolve(null);
    const work = this.update(metadata, origin, destination, segment, persist, recordedAt).finally(
      () => {
        this.pending.delete(id);
        this.cancelled.delete(id);
      },
    );
    this.pending.set(id, work);
    return work;
  }
  private async update(
    metadata: RouteMetadata | null,
    origin: Coordinates,
    destination: Coordinates,
    segment: 'pickup' | 'destination',
    persist: (m: RouteMetadata) => Promise<boolean>,
    recordedAt?: number,
  ): Promise<RouteMetadata | null> {
    const now = this.clock();
    const m: RouteMetadata = { lastCalculatedAt: null, lastOrigin: null, route: null, ...metadata };
    if (m.route && !validRouteResult(m.route)) {
      m.route = null;
      m.lastCalculatedAt = null;
    }
    if (
      recordedAt !== undefined &&
      m.lastValidatedTimestamp !== undefined &&
      recordedAt <= m.lastValidatedTimestamp
    )
      return null;
    const changedSegment =
      m.segment !== segment || !m.destination || geographicDistance(m.destination, destination) > 1;
    if (
      !changedSegment &&
      m.lastValidatedOrigin &&
      geographicDistance(m.lastValidatedOrigin, origin) < this.config.movementMeters
    )
      return null;
    m.lastValidatedOrigin = origin;
    if (recordedAt !== undefined) m.lastValidatedTimestamp = recordedAt;
    const points = m.route?.encodedPolyline ? decodePolyline(m.route.encodedPolyline) : [];
    const progress = points.length > 1 ? routeProgress(origin, points) : null;
    let state = m.routeState ?? 'ON_ROUTE';
    if (progress) {
      if (progress.deviationMeters > this.config.offRouteEnter) state = 'OFF_ROUTE';
      else if (progress.deviationMeters < this.config.offRouteExit) state = 'ON_ROUTE';
      m.deviationMeters = progress.deviationMeters;
      m.etaSeconds = Math.ceil(m.route!.durationSeconds * progress.remainingFraction);
    }
    m.routeState = state;
    const expired =
      m.lastCalculatedAt === null || now - m.lastCalculatedAt >= this.config.refreshMs;
    const needed = changedSegment || !m.route || state === 'OFF_ROUTE' || expired;
    if (
      needed &&
      ((m.lastExternalRequestAt === undefined && m.externalRequestReservedAt === undefined) ||
        now - Math.max(m.lastExternalRequestAt ?? 0, m.externalRequestReservedAt ?? 0) >=
          this.config.minRerouteMs)
    ) {
      let route: RouteResult | null = null;
      try {
        route = await this.provider.calculateRoute(origin, destination, {
          source: 'RIDE',
          beforeExternalRequest: async () => {
            // Reserve before paid HTTP work: a crash must not erase the cooldown.
            // This is deliberately distinct from the actual-attempt timestamp.
            m.externalRequestReservedAt = this.clock();
            if (!(await persist(m)))
              throw new AppError('MAP_RIDE_STATE_CHANGED', 'Ride navigation state changed', 409);
          },
          onExternalRequest: () => {
            m.lastExternalRequestAt = this.clock();
          },
        });
        if (route && !validRouteResult(route))
          throw new AppError('MAP_PROVIDER_INVALID', 'Invalid navigation route', 503);
      } catch {
        route = null;
        /* retain previous route and actual request timestamp, no fake success */
      }
      if (route) {
        m.route = route;
        m.lastCalculatedAt = this.clock();
        m.lastOrigin = origin;
        m.destination = destination;
        m.segment = segment;
        m.routeState = 'ON_ROUTE';
        m.etaSeconds = route.durationSeconds;
        m.routeVersion = (m.routeVersion ?? 0) + 1;
      }
    }
    return (await persist(m)) ? m : null;
  }
}
