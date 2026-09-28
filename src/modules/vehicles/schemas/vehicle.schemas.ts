import { z } from 'zod';

const uuid = z.string().uuid();

const vehicleText = z.string().trim().min(1).max(100);

const plateNumber = z.string().trim().min(1).max(20);

const vehicleSector = z.enum(['passenger', 'logistics', 'service', 'premium', 'rental']);

const vehicleCategory = z.string().trim().min(1).max(50);

const fuelType = z.string().trim().min(1).max(30);

const registrationDate = z.coerce.date();

const registrationExpiry = z.coerce.date();

export const vehicleIdSchema = z
  .object({
    id: uuid,
  })
  .strict();

export const vehicleDriverQuerySchema = z
  .object({
    driverProfileId: uuid,
    activeOnly: z.coerce.boolean().default(true),
  })
  .strict();

export const vehicleFleetQuerySchema = z
  .object({
    sector: vehicleSector.optional(),
    category: vehicleCategory.optional(),
  })
  .strict();

export const createVehicleSchema = z
  .object({
    /**
     * Nullable because a Partner Owned vehicle can exist
     * before a driver is assigned.
     */
    driverProfileId: uuid.nullable().optional(),

    /**
     * Owner of the physical vehicle.
     * Final authorization/business rules determine whether
     * the authenticated actor is allowed to use this value.
     */
    ownerId: uuid.nullable().optional(),

    make: vehicleText.max(50),

    model: vehicleText.max(50),

    color: z.string().trim().min(1).max(30).nullable().optional(),

    plateNumber,

    sector: vehicleSector.default('passenger'),

    category: vehicleCategory.default('sedan'),

    fuelRatePerKm: z.number().nonnegative().default(0),

    loadCapacityKg: z.number().nonnegative().default(0),

    manufacturingYear: z.number().int().min(1900).max(2100).nullable().optional(),

    fuelType: fuelType.nullable().optional(),

    seatingCapacity: z.number().int().positive().max(100).nullable().optional(),

    registrationDate: registrationDate.nullable().optional(),

    registrationExpiry: registrationExpiry.nullable().optional(),

    isCommercial: z.boolean().default(true),

    permitDetails: z.string().trim().max(5000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.registrationDate ||
      !value.registrationExpiry ||
      value.registrationExpiry >= value.registrationDate,
    {
      path: ['registrationExpiry'],
      message: 'registrationExpiry must be on or after registrationDate',
    },
  );

export const updateVehicleSchema = z
  .object({
    make: vehicleText.max(50).optional(),

    model: vehicleText.max(50).optional(),

    color: z.string().trim().min(1).max(30).nullable().optional(),

    plateNumber: plateNumber.optional(),

    sector: vehicleSector.optional(),

    category: vehicleCategory.optional(),

    fuelRatePerKm: z.number().nonnegative().optional(),

    loadCapacityKg: z.number().nonnegative().optional(),

    manufacturingYear: z.number().int().min(1900).max(2100).nullable().optional(),

    fuelType: fuelType.nullable().optional(),

    seatingCapacity: z.number().int().positive().max(100).nullable().optional(),

    registrationDate: registrationDate.nullable().optional(),

    registrationExpiry: registrationExpiry.nullable().optional(),

    isCommercial: z.boolean().optional(),

    permitDetails: z.string().trim().max(5000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })
  .refine(
    (value) =>
      !value.registrationDate ||
      !value.registrationExpiry ||
      value.registrationExpiry >= value.registrationDate,
    {
      path: ['registrationExpiry'],
      message: 'registrationExpiry must be on or after registrationDate',
    },
  );

export const deactivateVehicleSchema = z
  .object({
    retiredAt: z.coerce.date().optional(),
  })
  .strict();

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export type VehicleDriverQuery = z.infer<typeof vehicleDriverQuerySchema>;

export type VehicleFleetQuery = z.infer<typeof vehicleFleetQuerySchema>;

export type DeactivateVehicleInput = z.infer<typeof deactivateVehicleSchema>;
