import { z } from 'zod';
import { pool } from '../../infrastructure/database/postgres.js';
import { AppError } from '../../common/errors/app-error.js';
import { serviceCityAreas } from './service-city-areas.js';
import { CityRadiusPolicy } from './city-radius.js';
import { ServiceAreaPolicy } from './service-area.js';
import { readFileSync } from 'node:fs';

// Preserve the stored city coverage used by Service Vehicle dispatch.
const bihar = new ServiceAreaPolicy(
  JSON.parse(
    readFileSync(new URL('../../../config/service-area/bihar.geojson', import.meta.url), 'utf8'),
  ),
  true,
);
export const serviceCityInput = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z][a-z0-9_-]*$/),
    name: z.string().trim().min(1).max(100),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    source: z.string().trim().min(1).max(500),
    approvalReference: z.string().trim().min(1).max(500),
  })
  .strict();
type City = z.infer<typeof serviceCityInput>;
const legacyCities = [...serviceCityAreas.cities];
function cityArea(city: City) {
  return {
    id: city.id,
    name: city.name,
    approvalReference: city.approvalReference,
    area: new CityRadiusPolicy(city.id, city),
  };
}
async function readServiceCities() {
  const rows = (
    await pool.query<City>(
      `SELECT id,name,latitude,longitude,source,approval_reference AS "approvalReference" FROM premium_service_cities ORDER BY name,id`,
    )
  ).rows;
  const configured = [...legacyCities];
  for (const row of rows) {
    if (configured.some((c) => c.id === row.id))
      throw new AppError('PREMIUM_CITY_CONFLICT', 'Duplicate configured city identity', 503);
    await bihar.assertSupported([row]);
    configured.push(cityArea(row));
  }
  serviceCityAreas.cities.splice(0, serviceCityAreas.cities.length, ...configured);
  return configured.map(({ id, name }) => ({ id, name }));
}
let refresh: Promise<unknown> = Promise.resolve();
export function loadServiceCities() {
  const next = refresh.then(readServiceCities, readServiceCities);
  refresh = next;
  return next;
}
export async function registerServiceCity(input: unknown, actorId: string) {
  const city = serviceCityInput.parse(input);
  await bihar.assertSupported([city]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(874099)');
    const existing = (
      await client.query<City>(
        `SELECT id,name,latitude,longitude,source,approval_reference AS "approvalReference" FROM premium_service_cities`,
      )
    ).rows;
    const all = [...legacyCities, ...existing.map(cityArea)];
    if (all.length >= 200)
      throw new AppError('PREMIUM_CITY_LIMIT', 'Configured city limit reached', 409);
    if (all.some((c) => c.id === city.id || c.name.toLowerCase() === city.name.toLowerCase()))
      throw new AppError('PREMIUM_CITY_EXISTS', 'This city is already configured', 409);
    for (const configured of all) {
      const area = JSON.parse(configured.area.boundaryGeoJson!);
      const overlap = (
        await client.query<{ overlap: boolean }>(
          `SELECT ST_DWithin(ST_SetSRID(ST_GeomFromGeoJSON($1),4326)::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4) AS overlap`,
          [
            JSON.stringify(area),
            city.longitude,
            city.latitude,
            area.type === 'Point' ? 50000 : 25000,
          ],
        )
      ).rows[0]?.overlap;
      if (overlap)
        throw new AppError(
          'PREMIUM_CITY_OVERLAP',
          'This city overlaps an existing dispatch service area',
          422,
        );
    }
    await client.query(
      `INSERT INTO premium_service_cities(id,name,latitude,longitude,source,approval_reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        city.id,
        city.name,
        city.latitude,
        city.longitude,
        city.source,
        city.approvalReference,
        actorId,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await loadServiceCities();
  return { id: city.id, name: city.name };
}
