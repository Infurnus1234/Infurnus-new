import { readFileSync } from 'node:fs';
import { pool } from '../../infrastructure/database/postgres.js';
import { AppError } from '../../common/errors/app-error.js';
import { validateCoordinates } from './geometry.js';
import type { Coordinates } from '../rides/providers/map.provider.js';
import type { ServiceAreaGate } from './service-area.js';

export const CITY_SERVICE_RADIUS_METERS = 25000;
export const cityReferences = JSON.parse(
  readFileSync(
    new URL('../../../config/service-area/city-references.json', import.meta.url),
    'utf8',
  ),
) as Record<string, Coordinates & { name: string; source: string }>;

/** Boundary expressions are internal SQL, never request input. Points are geometry. */
export function cityCoverageSql(boundary: string, point: string): string {
  const json = `(${boundary})::jsonb`;
  const geometry = `ST_SetSRID(ST_GeomFromGeoJSON((${json})::text),4326)`;
  return `(CASE WHEN ${json}->>'type'='Point' THEN
    ${json}->>'radiusMeters'='25000' AND ST_DWithin(${geometry}::geography,(${point})::geography,25000.000001)
    ELSE ST_Covers(${geometry},${point}) END)`;
}

export class CityRadiusPolicy implements ServiceAreaGate {
  readonly configured = true;
  readonly required = true;
  readonly boundaryGeoJson: string;
  constructor(
    readonly cityId: string,
    readonly reference: Coordinates & { source: string },
    radiusMeters = CITY_SERVICE_RADIUS_METERS,
  ) {
    validateCoordinates(reference);
    if (!cityId.trim() || radiusMeters !== CITY_SERVICE_RADIUS_METERS || !reference.source.trim())
      throw Error('A sourced city identity and exact 25000 metre radius are required');
    this.boundaryGeoJson = JSON.stringify({
      type: 'Point',
      coordinates: [reference.longitude, reference.latitude],
      radiusMeters,
      cityId,
      source: reference.source,
    });
  }
  async assertSupported(points: Coordinates[]): Promise<void> {
    if (points.length > 100)
      throw new AppError('MAP_INPUT_INVALID', 'Too many service-area points', 400);
    points.forEach(validateCoordinates);
    const result = await pool.query(
      `SELECT COALESCE(bool_and(${cityCoverageSql('$1', "ST_SetSRID(ST_MakePoint((point->>'longitude')::float8,(point->>'latitude')::float8),4326)")}),TRUE) AS supported FROM jsonb_array_elements($2::jsonb) point`,
      [this.boundaryGeoJson, JSON.stringify(points)],
    );
    if (!result.rows[0]?.supported)
      throw new AppError('SERVICE_AREA_UNAVAILABLE', "We're coming soon to your area.", 422);
  }
}
