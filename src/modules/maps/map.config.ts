import { env } from '../../config/env.js';

export const mapConfig = {
  region: env.MAP_REGION,
  country: env.MAP_COUNTRY,
  searchTtl: env.MAP_SEARCH_CACHE_TTL,
  geocodeTtl: env.MAP_GEOCODE_CACHE_TTL,
  reverseTtl: env.MAP_REVERSE_CACHE_TTL,
  routeTtl: env.MAP_ROUTE_CACHE_TTL,
  distanceTtl: env.MAP_DISTANCE_CACHE_TTL,
  popularTtl: env.MAP_POPULAR_CACHE_TTL,
  reversePrecision: env.MAP_REVERSE_PRECISION,
  movementMeters: env.MAP_MOVEMENT_THRESHOLD_METERS,
  offRouteEnter: env.MAP_OFF_ROUTE_ENTER_METERS,
  offRouteExit: env.MAP_OFF_ROUTE_EXIT_METERS,
  minRerouteMs: env.MAP_MIN_REROUTE_INTERVAL_MS,
  refreshMs: env.MAP_ROUTE_REFRESH_MS,
  cacheTimeoutMs: env.MAP_CACHE_TIMEOUT_MS,
  lockMs: env.MAP_REQUEST_LOCK_MS,
  rateLimit: env.MAP_RATE_LIMIT_MAX,
  providerContentCaching: env.MAP_PROVIDER_CONTENT_CACHING,
};

export type MapConfig = typeof mapConfig;
