import { AppError } from '../../common/errors/app-error.js';
import type { Coordinates, RouteResult } from '../rides/providers/map.provider.js';

export function validRouteResult(value: unknown): value is RouteResult {
  if (!value || typeof value !== 'object') return false;
  const route = value as RouteResult;
  return (
    Number.isFinite(route.distanceMeters) &&
    route.distanceMeters >= 0 &&
    Number.isFinite(route.durationSeconds) &&
    route.durationSeconds >= 0 &&
    (route.encodedPolyline === undefined ||
      (typeof route.encodedPolyline === 'string' &&
        decodePolyline(route.encodedPolyline).length >= 2))
  );
}

export function validateCoordinates(point: Coordinates): void {
  if (
    !point ||
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    Math.abs(point.latitude) > 90 ||
    Math.abs(point.longitude) > 180
  )
    throw new AppError('MAP_INPUT_INVALID', 'Valid coordinates are required', 400);
}

export function geographicDistance(a: Coordinates, b: Coordinates): number {
  validateCoordinates(a);
  validateCoordinates(b);
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * r) / 2) ** 2 +
    Math.cos(a.latitude * r) *
      Math.cos(b.latitude * r) *
      Math.sin(((b.longitude - a.longitude) * r) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function decodePolyline(encoded: string): Coordinates[] {
  if (encoded.length > 200000) return [];
  const points: Coordinates[] = [];
  let index = 0,
    lat = 0,
    lng = 0;
  const next = () => {
    let result = 0,
      shift = 0,
      byte: number;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid polyline');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid polyline');
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  try {
    while (index < encoded.length) {
      lat += next();
      lng += next();
      const point = { latitude: lat / 100000, longitude: lng / 100000 };
      validateCoordinates(point);
      points.push(point);
    }
  } catch {
    return [];
  }
  return points;
}

/** Project onto route segments locally; distances and progress are metres. */
export function routeProgress(point: Coordinates, route: Coordinates[]) {
  validateCoordinates(point);
  let total = 0,
    best = Infinity,
    progress = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!,
      b = route[i]!;
    const scaleX = 111195 * Math.cos((point.latitude * Math.PI) / 180),
      scaleY = 111195;
    const ax = (a.longitude - point.longitude) * scaleX,
      ay = (a.latitude - point.latitude) * scaleY;
    const bx = (b.longitude - point.longitude) * scaleX,
      by = (b.latitude - point.latitude) * scaleY;
    const dx = bx - ax,
      dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    const length = geographicDistance(a, b);
    if (distance < best) {
      best = distance;
      progress = total + t * length;
    }
    total += length;
  }
  return {
    deviationMeters: best,
    remainingFraction: total ? Math.max(0, 1 - progress / total) : 0,
  };
}
