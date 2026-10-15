import { mkdtempSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PremiumCityAreas } from '../premium-city-areas.js';
const folders: string[] = [];
function registry(overlap = false) {
  const folder = mkdtempSync(join(tmpdir(), 'premium-test-'));
  folders.push(folder);
  // Synthetic test geometry, never an approved production city boundary.
  for (const [name, x] of [
    ['a', 0],
    ['b', overlap ? 0 : 2],
  ] as const)
    writeFileSync(
      join(folder, `${name}.geojson`),
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [x, 0],
            [x + 1, 0],
            [x + 1, 1],
            [x, 1],
            [x, 0],
          ],
        ],
      }),
    );
  const cities = ['a', 'b'].map((id) => ({
    id,
    name: `TEST ONLY ${id}`,
    boundaryFile: `${id}.geojson`,
    verified: true,
    approvalReference: 'SYNTHETIC UNIT TEST ONLY',
  }));
  const file = join(folder, 'cities.json');
  writeFileSync(file, JSON.stringify({ cities }));
  return { file, folder, cities };
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
describe('premium city manifest safeguards', () => {
  it('rejects whitespace-only approval references', () => {
    const { file, cities } = registry();
    writeFileSync(file, JSON.stringify({ cities: [{ ...cities[0], approvalReference: '   ' }] }));
    expect(() => new PremiumCityAreas(file)).toThrow();
  });
  it('rejects missing city boundary files', () => {
    const { file, cities } = registry();
    writeFileSync(
      file,
      JSON.stringify({ cities: [{ ...cities[0], boundaryFile: 'missing.geojson' }] }),
    );
    expect(() => new PremiumCityAreas(file)).toThrow();
  });
  it('rejects malformed GeoJSON and nonpolygon geometry', () => {
    const { file, folder } = registry();
    writeFileSync(join(folder, 'a.geojson'), '{broken');
    expect(() => new PremiumCityAreas(file)).toThrow();
    writeFileSync(
      join(folder, 'a.geojson'),
      JSON.stringify({ type: 'Point', coordinates: [0, 0] }),
    );
    expect(() => new PremiumCityAreas(file)).toThrow();
  });
  it('blocks all premium pickups without an approved manifest', async () => {
    await expect(
      new PremiumCityAreas().resolve({ latitude: 25.6, longitude: 85.1 }),
    ).rejects.toMatchObject({ code: 'PREMIUM_CITY_NOT_CONFIGURED' });
  });
  it('requires explicit verification and approval metadata', () => {
    const { file, cities } = registry();
    writeFileSync(file, JSON.stringify({ cities: [{ ...cities[0], verified: false }] }));
    expect(() => new PremiumCityAreas(file)).toThrow();
  });
  it('rejects duplicate city IDs', () => {
    const { file, cities } = registry();
    writeFileSync(file, JSON.stringify({ cities: [cities[0], cities[0]] }));
    expect(() => new PremiumCityAreas(file)).toThrow('Duplicate');
  });
  it('does not accept the Bihar statewide file as city coverage', () => {
    const { file, cities } = registry();
    writeFileSync(
      file,
      JSON.stringify({ cities: [{ ...cities[0], boundaryFile: 'bihar.geojson' }] }),
    );
    expect(() => new PremiumCityAreas(file)).toThrow('Statewide');
  });
});
describe.skipIf(process.env.RIDE_DB_TESTS !== 'true')('premium city PostGIS validation', () => {
  it('profiles twenty synthetic city boundaries of five thousand vertices each', async () => {
    const { file, folder } = registry();
    const cities = [];
    for (let city = 0; city < 20; city++) {
      const ring = Array.from({ length: 5000 }, (_, i) => [
        city * 2 + 0.5 + 0.4 * Math.cos((i * 2 * Math.PI) / 5000),
        0.5 + 0.4 * Math.sin((i * 2 * Math.PI) / 5000),
      ]);
      ring.push(ring[0]!);
      writeFileSync(
        join(folder, `dense-${city}.geojson`),
        JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
      );
      cities.push({
        id: `synthetic-${city}`,
        name: `TEST ONLY ${city}`,
        boundaryFile: `dense-${city}.geojson`,
        verified: true,
        approvalReference: 'SYNTHETIC PERFORMANCE FIXTURE; NOT CITY APPROVAL',
      });
    }
    writeFileSync(file, JSON.stringify({ cities }));
    const areas = new PremiumCityAreas(file),
      samples = [];
    for (let i = 0; i < 6; i++) {
      const started = performance.now();
      expect((await areas.resolve({ latitude: 0.5, longitude: 38.5 })).cityId).toBe('synthetic-19');
      samples.push(performance.now() - started);
    }
    if (process.env.DISPATCH_QA_EVIDENCE_DIR)
      appendFileSync(
        join(process.env.DISPATCH_QA_EVIDENCE_DIR, 'qa-observations.jsonl'),
        JSON.stringify({
          id: 'OPS-CITY-PERF',
          cities: 20,
          verticesPerCity: 5001,
          lookups: 6,
          containmentQueries: 120,
          samplesMs: samples,
          synthetic: true,
        }) + '\n',
      );
  }, 20000);
  it('selects the corresponding city and blocks unsupported pickups', async () => {
    const areas = new PremiumCityAreas(registry().file);
    expect((await areas.resolve({ latitude: 0.5, longitude: 0.5 })).cityId).toBe('a');
    expect((await areas.resolve({ latitude: 0.5, longitude: 2.5 })).cityId).toBe('b');
    await expect(areas.resolve({ latitude: 0.5, longitude: 1.5 })).rejects.toMatchObject({
      code: 'PREMIUM_CITY_NOT_CONFIGURED',
    });
  });
  it('includes city boundary edges', async () => {
    expect(
      (await new PremiumCityAreas(registry().file).resolve({ latitude: 0, longitude: 0 })).cityId,
    ).toBe('a');
  });
  it('fails closed on ambiguous overlapping cities', async () => {
    await expect(
      new PremiumCityAreas(registry(true).file).resolve({ latitude: 0.5, longitude: 0.5 }),
    ).rejects.toMatchObject({ code: 'PREMIUM_CITY_NOT_CONFIGURED' });
  });
  it('fails closed on an invalid polygon', async () => {
    const { file, folder } = registry();
    writeFileSync(
      join(folder, 'a.geojson'),
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [1, 0],
            [0, 1],
            [0, 0],
          ],
        ],
      }),
    );
    await expect(
      new PremiumCityAreas(file).resolve({ latitude: 0.5, longitude: 0.5 }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
