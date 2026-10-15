import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { CityRadiusPolicy, cityReferences } from '../city-radius.js';
import { PremiumCityAreas } from '../premium-city-areas.js';
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const entry = {
  id: 'patna',
  name: 'Patna',
  referenceId: 'patna',
  radiusMeters: 25000,
  verified: true,
  approvalReference: 'TEST manifest for approved owner radius policy',
};
function manifest(city: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'city-radius-test-'));
  folders.push(dir);
  const file = join(dir, 'manifest.json');
  writeFileSync(file, JSON.stringify({ cities: [city] }));
  return file;
}
describe('city reference identity validation', () => {
  it.each([
    { ...entry, referenceId: 'missing' },
    { ...entry, id: 'muzaffarpur' },
    { ...entry, name: 'Motihari' },
    { ...entry, radiusMeters: 20000 },
    { ...entry, radiusMeters: undefined },
    { ...entry, referencePoint: { latitude: 85.1, longitude: 25.6 } },
  ])('rejects missing, wrong, swapped or overridden reference metadata %#', (city) => {
    expect(() => new PremiumCityAreas(manifest(city))).toThrow();
  });
  it.each([NaN, Infinity, 91, -91])('rejects invalid latitude %s', (latitude) => {
    expect(
      () => new CityRadiusPolicy('TEST', { latitude, longitude: 85.1, source: 'TEST' }),
    ).toThrow();
  });
  it('loads the sourced operational reference registry without a polygon', () => {
    const areas = new PremiumCityAreas('config/service-area/premium-city-radius.json');
    expect(areas.cities.map((city) => city.id)).toEqual(['patna', 'muzaffarpur']);
    expect(cityReferences.patna!.source).toBe(
      'https://www.packolkata.gov.in/download/smrs/Patna.pdf',
    );
    expect(JSON.parse(areas.cities[0]!.area.boundaryGeoJson!).coordinates).toEqual([85.1, 25.6]);
  });
});
describe.skipIf(process.env.RIDE_DB_TESTS !== 'true')('city radius real PostGIS', () => {
  it.each([-0.01, 0, 0.01])(
    'enforces the 25 km geographic edge at delta %s metres',
    async (delta) => {
      const area = new CityRadiusPolicy('patna', cityReferences.patna!);
      for (const bearing of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const result = await pool.query(
          'SELECT ST_Y(p::geometry) AS latitude,ST_X(p::geometry) AS longitude FROM (SELECT ST_Project(ST_SetSRID(ST_MakePoint(85.1,25.6),4326)::geography,$1::float8,$2::float8) p) projected',
          [25000 + delta, bearing],
        );
        if (delta <= 0) await expect(area.assertSupported(result.rows)).resolves.toBeUndefined();
        else
          await expect(area.assertSupported(result.rows)).rejects.toMatchObject({
            statusCode: 422,
          });
      }
    },
  );
  it('resolves each real city independently and blocks unsupported statewide locations', async () => {
    const areas = new PremiumCityAreas('config/service-area/premium-city-radius.json');
    expect((await areas.resolve(cityReferences.patna!)).cityId).toBe('patna');
    expect((await areas.resolve(cityReferences.muzaffarpur!)).cityId).toBe('muzaffarpur');
    await expect(areas.resolve({ latitude: 26.65, longitude: 84.91 })).rejects.toMatchObject({
      code: 'PREMIUM_CITY_NOT_CONFIGURED',
    });
    await expect(areas.resolve({ latitude: 85.1, longitude: 25.6 })).rejects.toMatchObject({
      code: 'PREMIUM_CITY_NOT_CONFIGURED',
    });
  });
});
