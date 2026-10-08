import { readFileSync, statSync } from 'node:fs';
import { pool } from '../../infrastructure/database/postgres.js';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { validateCoordinates } from './geometry.js';
import type { Coordinates } from '../rides/providers/map.provider.js';

export interface ServiceAreaGate {
  readonly configured: boolean;
  readonly required: boolean;
  assertSupported(points: Coordinates[]): Promise<void>;
}

// The mounted file is an operator-approved geometry, never a guessed Bihar boundary.
// ST_Covers includes the boundary itself and respects polygon holes/multipolygons.
export class ServiceAreaPolicy implements ServiceAreaGate {
  readonly configured: boolean;
  private readonly geometry?: string;
  constructor(
    boundary: unknown,
    readonly required = true,
  ) {
    this.configured = boundary !== undefined;
    if (this.configured) {
      if (
        !boundary ||
        typeof boundary !== 'object' ||
        !['Polygon', 'MultiPolygon'].includes((boundary as { type?: string }).type ?? '')
      )
        throw new Error(
          'Service-area boundary must be an approved GeoJSON Polygon or MultiPolygon',
        );
      this.geometry = JSON.stringify(boundary);
      if (Buffer.byteLength(this.geometry, 'utf8') > 2000000)
        throw new Error('Service-area boundary exceeds the supported size');
    }
  }

  async assertSupported(points: Coordinates[]): Promise<void> {
    if (points.length > 100)
      throw new AppError('MAP_INPUT_INVALID', 'Too many service-area points', 400);
    points.forEach(validateCoordinates);
    if (!this.geometry) {
      if (this.required)
        throw new AppError(
          'SERVICE_AREA_NOT_CONFIGURED',
          'Approved service-area boundary is not configured',
          503,
        );
      return; // Development compatibility is unknown coverage, not proof of eligibility.
    }
    let result;
    try {
      result = await pool.query<{ valid: boolean; supported: boolean }>(
        `WITH boundary AS (SELECT ST_GeomFromGeoJSON($1) AS geom)
         SELECT ST_SRID(geom)=4326 AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)
           AND ST_XMin(Box3D(geom)) >= -180 AND ST_XMax(Box3D(geom)) <= 180
           AND ST_YMin(Box3D(geom)) >= -90 AND ST_YMax(Box3D(geom)) <= 90 AS valid,
           COALESCE((SELECT bool_and(ST_Covers(geom,
             ST_SetSRID(ST_MakePoint((point->>'longitude')::float8,
                                    (point->>'latitude')::float8), 4326)))
             FROM jsonb_array_elements($2::jsonb) AS point), TRUE) AS supported
         FROM boundary`,
        [this.geometry, JSON.stringify(points)],
      );
    } catch {
      throw new AppError(
        'SERVICE_AREA_UNAVAILABLE',
        'Service-area validation is temporarily unavailable',
        503,
      );
    }
    if (!result.rows[0]?.valid)
      throw new AppError(
        'SERVICE_AREA_NOT_CONFIGURED',
        'Approved service-area boundary is invalid',
        503,
      );
    if (!result.rows[0].supported)
      throw new AppError('SERVICE_AREA_UNAVAILABLE', "We're coming soon to your area.", 422);
  }
}

function loadBoundary(file: string): unknown {
  if (statSync(file).size > 2000000)
    throw new Error('Service-area boundary exceeds the supported size');
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}
export const serviceArea = new ServiceAreaPolicy(
  env.MAP_SERVICE_AREA_BOUNDARY_FILE ? loadBoundary(env.MAP_SERVICE_AREA_BOUNDARY_FILE) : undefined,
  env.NODE_ENV === 'production' || env.NODE_ENV === 'staging',
);
