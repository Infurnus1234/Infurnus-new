import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ServiceAreaPolicy } from './service-area.js';
import { AppError } from '../../common/errors/app-error.js';
export const operatingLocationSchema = z
  .object({
    address: z.string().trim().min(1).max(500),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
export type OperatingLocation = z.infer<typeof operatingLocationSchema>;
const bihar = new ServiceAreaPolicy(
  JSON.parse(
    readFileSync(new URL('../../../config/service-area/bihar.geojson', import.meta.url), 'utf8'),
  ),
  true,
);
export async function validateOperatingLocation(location: OperatingLocation) {
  try {
    await bihar.assertSupported([operatingLocationSchema.parse(location)]);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 422)
      throw new AppError(
        'OPERATING_LOCATION_OUTSIDE_BIHAR',
        'Choose an operating location within Bihar.',
        422,
      );
    throw error;
  }
}
export function requirePremiumOperatingLocation(
  sector: string,
  location?: OperatingLocation | null,
) {
  if (sector === 'premium' && !location)
    throw new AppError(
      'OPERATING_LOCATION_REQUIRED',
      'Select the vehicle operating location within Bihar.',
      422,
    );
}
