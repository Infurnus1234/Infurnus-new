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
    speed: z.number().finite().min(0).optional(),
    heading: z.number().finite().min(0).max(360).optional(),
  })
  .strict();

export type DriverAvailabilityInput = z.infer<typeof driverAvailabilitySchema>;
export type DriverLocationInput = z.infer<typeof driverLocationSchema>;

export const upsertDriverProfileSchema = z
  .object({
    licenseNumber: z.string().trim().min(1, 'License number is required').max(50),
    licenseExpiry: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'License expiry must be in YYYY-MM-DD format'),
    profilePhotoKey: z.string().trim().max(500).optional(),
    licenseDocumentKey: z.string().trim().max(500).optional(),
    vehicleRcDocumentKey: z.string().trim().max(500).optional(),
  })
  .strict();

export type UpsertDriverProfileInput = z.infer<typeof upsertDriverProfileSchema>;
