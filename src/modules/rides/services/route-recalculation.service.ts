import { env } from '../../../config/env.js';
import type { Coordinates, MapProvider, RouteResult } from '../providers/map.provider.js';

export class RouteRecalculationService {
  constructor(
    private readonly provider: MapProvider,
    private readonly clock: () => number = Date.now,
  ) {}

  shouldRecalculate(
    lastCalculatedAt: number | null,
    lastOrigin: Coordinates | null,
    origin: Coordinates,
  ) {
    if (lastCalculatedAt === null || lastOrigin === null) return true;
    const elapsed = (this.clock() - lastCalculatedAt) / 1000;
    return (
      elapsed >= env.GOOGLE_ROUTE_RECALCULATION_INTERVAL_SECONDS ||
      distanceMeters(lastOrigin, origin) >= env.GOOGLE_ROUTE_RECALCULATION_DISTANCE_METERS
    );
  }

  calculate(origin: Coordinates, destination: Coordinates): Promise<RouteResult | null> {
    return this.provider.calculateRoute(origin, destination);
  }
}

function distanceMeters(first: Coordinates, second: Coordinates): number {
  const earthRadius = 6_371_000;
  const latitude = ((second.latitude - first.latitude) * Math.PI) / 180;
  const longitude = ((second.longitude - first.longitude) * Math.PI) / 180;
  const a =
    Math.sin(latitude / 2) ** 2 +
    Math.cos((first.latitude * Math.PI) / 180) *
      Math.cos((second.latitude * Math.PI) / 180) *
      Math.sin(longitude / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
