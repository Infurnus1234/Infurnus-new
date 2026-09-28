import { z } from 'zod';

import {
  DRIVER_APPLICATION_SECTORS,
  DRIVER_APPLICATION_STATUSES,
  VEHICLE_OWNERSHIP_TYPES,
} from './driver-application.types.js';

export const createDriverApplicationSchema = z
  .object({
    partnerId: z.string().uuid(),
    driverProfileId: z.string().uuid(),

    requestedSector: z.enum(DRIVER_APPLICATION_SECTORS),

    requestedVehicleCategory: z.string().trim().min(1).max(50),

    vehicleOwnershipType: z.enum(VEHICLE_OWNERSHIP_TYPES),
  })
  .strict();

export const reviewDriverApplicationSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),

    reviewReason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if ((data.status === 'REJECTED' || data.status === 'CHANGES_REQUESTED') && !data.reviewReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reviewReason'],
        message: 'Review reason is required when rejecting or requesting changes.',
      });
    }
  });

export const updateDriverApplicationStatusSchema = z
  .object({
    status: z.enum(DRIVER_APPLICATION_STATUSES),

    reviewReason: z.string().trim().max(1000).optional(),
  })
  .strict();

export const driverApplicationIdParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const driverApplicationFiltersSchema = z
  .object({
    status: z.enum(DRIVER_APPLICATION_STATUSES).optional(),

    requestedSector: z.enum(DRIVER_APPLICATION_SECTORS).optional(),

    requestedVehicleCategory: z.string().trim().min(1).max(50).optional(),

    vehicleOwnershipType: z.enum(VEHICLE_OWNERSHIP_TYPES).optional(),

    partnerId: z.string().uuid().optional(),

    driverProfileId: z.string().uuid().optional(),

    reviewedBy: z.string().uuid().optional(),

    approvedBy: z.string().uuid().optional(),

    page: z.coerce.number().int().min(1).default(1),

    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type CreateDriverApplicationInput = z.infer<typeof createDriverApplicationSchema>;

export type ReviewDriverApplicationInput = z.infer<typeof reviewDriverApplicationSchema>;

export type UpdateDriverApplicationStatusInput = z.infer<
  typeof updateDriverApplicationStatusSchema
>;

export type DriverApplicationFiltersInput = z.infer<typeof driverApplicationFiltersSchema>;
