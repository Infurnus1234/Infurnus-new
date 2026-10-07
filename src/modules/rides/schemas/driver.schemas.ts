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
    accuracy: z.number().finite().min(0).optional(),
  })
  .strict();

export type DriverAvailabilityInput = z.infer<typeof driverAvailabilitySchema>;
export type DriverLocationInput = z.infer<typeof driverLocationSchema>;

export const driverDocumentMetadataSchema = z
  .object({
    uploadSource: z.enum(['CAMERA', 'GALLERY', 'FILE']).default('FILE'),
    documentCode: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,49}$/)
      .optional(),
    documentNumber: z.string().trim().min(1).max(100).optional(),
    issuingAuthority: z.string().trim().min(1).max(150).optional(),
    issuedAt: z.iso.date().optional(),
    expiresAt: z.iso.date().optional(),
    side: z.enum(['FRONT', 'BACK', 'PAGE']).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.expiresAt && data.expiresAt < new Date().toISOString().slice(0, 10))
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Expired documents cannot be submitted',
      });
    if (data.issuedAt && data.expiresAt && data.issuedAt > data.expiresAt)
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Expiry must follow issue date',
      });
  });

export const upsertDriverProfileSchema = z
  .object({
    licenseNumber: z.string().trim().min(1, 'License number is required').max(50),
    licenseExpiry: z.iso
      .date()
      .refine(
        (value) => value >= new Date().toISOString().slice(0, 10),
        'Driving licence is expired',
      ),
    dob: z.iso
      .date()
      .refine(
        (value) => value <= new Date().toISOString().slice(0, 10),
        'Date of birth cannot be in the future',
      )
      .optional(),
    gender: z.string().trim().max(20).optional(),
    address: z.string().trim().max(500).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    pinCode: z.string().trim().max(20).optional(),
    emergencyContactName: z.string().trim().max(100).optional(),
    emergencyContactPhone: z.string().trim().max(20).optional(),
    emergencyContactRelationship: z.string().trim().max(100).optional(),
    alternateContactPhone: z.string().trim().max(20).optional(),
  })
  .strict();

export type UpsertDriverProfileInput = z.infer<typeof upsertDriverProfileSchema>;

export const verifyAssignmentCodeSchema = z
  .object({
    code: z.string().trim().min(1, 'Code is required').max(20),
  })
  .strict();

export type VerifyAssignmentCodeInput = z.infer<typeof verifyAssignmentCodeSchema>;

export const claimAssignmentCodeSchema = z
  .object({
    code: z.string().trim().min(1, 'Code is required').max(20),
  })
  .strict();

export type ClaimAssignmentCodeInput = z.infer<typeof claimAssignmentCodeSchema>;

export const selectActiveVehicleSchema = z
  .object({
    vehicleId: z.string().uuid('Invalid vehicle ID'),
  })
  .strict();

export type SelectActiveVehicleInput = z.infer<typeof selectActiveVehicleSchema>;
