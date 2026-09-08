import { z } from 'zod';
import { driverAvailabilityStatuses } from '../types/driver.js';

const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);

export const driverAvailabilitySchema = z
  .object({ status: z.enum(driverAvailabilityStatuses) })
  .strict();

export const driverLocationSchema = z
  .object({
    latitude,
    longitude,
    timestamp: z.coerce.date(),
  })
  .strict();

export type DriverAvailabilityInput = z.infer<typeof driverAvailabilitySchema>;
export type DriverLocationInput = z.infer<typeof driverLocationSchema>;
