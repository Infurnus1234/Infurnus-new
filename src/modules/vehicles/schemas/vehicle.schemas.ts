import { z } from 'zod';

const uuid = z.string().uuid();
const vehicleText = z.string().trim().min(1).max(100);
const plateNumber = z.string().trim().min(1).max(20);

export const vehicleIdSchema = z.object({ id: uuid }).strict();
export const vehicleDriverQuerySchema = z
  .object({
    driverProfileId: uuid,
    activeOnly: z.coerce.boolean().default(true),
  })
  .strict();

export const createVehicleSchema = z
  .object({
    driverProfileId: uuid,
    make: vehicleText.max(50),
    model: vehicleText.max(50),
    color: z.string().trim().min(1).max(30).optional(),
    plateNumber,
  })
  .strict();

export const updateVehicleSchema = z
  .object({
    make: vehicleText.max(50).optional(),
    model: vehicleText.max(50).optional(),
    color: z.string().trim().min(1).max(30).nullable().optional(),
    plateNumber: plateNumber.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const deactivateVehicleSchema = z
  .object({
    retiredAt: z.coerce.date().optional(),
  })
  .strict();

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type VehicleDriverQuery = z.infer<typeof vehicleDriverQuerySchema>;
export type DeactivateVehicleInput = z.infer<typeof deactivateVehicleSchema>;
