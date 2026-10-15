import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { ServiceAreaPolicy, type ServiceAreaGate } from './service-area.js';
import { CityRadiusPolicy, cityReferences } from './city-radius.js';
import type { Coordinates } from '../rides/providers/map.provider.js';
const manifestSchema = z
  .object({
    cities: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(100),
            name: z.string().trim().min(1).max(100),
            boundaryFile: z.string().min(1).optional(),
            referenceId: z.string().min(1).optional(),
            radiusMeters: z.literal(25000).optional(),
            verified: z.literal(true),
            approvalReference: z.string().trim().min(1).max(500),
          })
          .strict()
          .refine(
            (city) => Boolean(city.boundaryFile) !== Boolean(city.referenceId),
            'Choose one city reference or legacy boundary',
          ),
      )
      .max(200),
  })
  .strict();
export class PremiumCityAreas {
  readonly cities: {
    id: string;
    name: string;
    boundaryFile?: string | undefined;
    approvalReference: string;
    area: ServiceAreaGate;
  }[];
  constructor(manifestFile?: string) {
    this.cities = [];
    if (!manifestFile) return;
    if (statSync(manifestFile).size > 2000000)
      throw Error('Premium city manifest exceeds supported size');
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestFile, 'utf8')));
    const ids = new Set<string>();
    for (const city of manifest.cities) {
      if (ids.has(city.id)) throw Error('Duplicate premium city identifier');
      ids.add(city.id);
      if (city.referenceId) {
        const reference = cityReferences[city.referenceId];
        if (
          !reference ||
          city.id !== city.referenceId ||
          city.name !== reference.name ||
          city.radiusMeters !== 25000
        )
          throw Error('City reference identity or radius is invalid');
        this.cities.push({ ...city, area: new CityRadiusPolicy(city.id, reference) });
        continue;
      }
      const file = resolve(dirname(manifestFile), city.boundaryFile!);
      if (
        basename(file).toLowerCase() === 'bihar.geojson' ||
        (env.MAP_SERVICE_AREA_BOUNDARY_FILE && file === resolve(env.MAP_SERVICE_AREA_BOUNDARY_FILE))
      )
        throw Error('Statewide/general service boundary cannot be registered as a premium city');
      if (statSync(file).size > 2000000)
        throw Error('Premium city boundary exceeds supported size');
      this.cities.push({
        ...city,
        boundaryFile: file,
        area: new ServiceAreaPolicy(JSON.parse(readFileSync(file, 'utf8')), true),
      });
    }
  }
  async resolve(pickup: Coordinates): Promise<{ cityId: string; boundaryGeoJson: string }> {
    const matches = [];
    for (const city of this.cities) {
      try {
        await city.area.assertSupported([pickup]);
        matches.push(city);
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 422) throw error;
      }
    }
    if (matches.length !== 1)
      throw new AppError(
        'PREMIUM_CITY_NOT_CONFIGURED',
        matches.length
          ? 'Premium city boundaries overlap; approved coverage must be resolved'
          : 'No verified premium city boundary covers this pickup',
        503,
      );
    return { cityId: matches[0]!.id, boundaryGeoJson: matches[0]!.area.boundaryGeoJson! };
  }
}
export const premiumCityAreas = new PremiumCityAreas(env.PREMIUM_CITY_SERVICE_AREAS_FILE);
