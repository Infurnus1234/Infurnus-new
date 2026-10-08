import { z } from 'zod';

export const fleetListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    sector: z.enum(['passenger', 'logistics', 'service', 'premium', 'rental']).optional(),
    category: z.string().trim().min(1).max(50).optional(),
    active: z.enum(['true', 'false']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    availability: z.enum(['available', 'unavailable', 'busy', 'stale']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();
export type FleetListQuery = z.infer<typeof fleetListQuerySchema>;

export const createFleetVehicleSchema = z
  .object({
    make: z.string().trim().min(1, 'Make is required').max(50),
    model: z.string().trim().min(1, 'Model is required').max(50),
    color: z.string().trim().max(30).optional(),
    plateNumber: z.string().trim().min(1, 'Plate number is required').max(20).toUpperCase(),
    sector: z.enum(['passenger', 'logistics', 'service', 'premium']).default('passenger'),
    category: z.string().trim().min(1).default('sedan'),
    fuelRatePerKm: z.number().finite().min(0).default(0),
    loadCapacityKg: z.number().finite().min(0).default(0),
    year: z.number().int().min(1990).max(2035).optional(),
    fuelType: z.string().trim().max(30).optional(),
    seatingCapacity: z.number().int().min(1).max(100).optional(),
    registrationDate: z.iso.date().optional(),
    registrationExpiry: z.iso.date().optional(),
    isCommercial: z.boolean().default(true),
    permitDetails: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateFleetVehicleInput = z.infer<typeof createFleetVehicleSchema>;

export const updateFleetVehicleSchema = z
  .object({
    make: z.string().trim().min(1).max(50).optional(),
    model: z.string().trim().min(1).max(50).optional(),
    color: z.string().trim().max(30).optional(),
    plateNumber: z.string().trim().min(1).max(20).toUpperCase().optional(),
    sector: z.enum(['passenger', 'logistics', 'service', 'premium']).optional(),
    category: z.string().trim().min(1).optional(),
    fuelRatePerKm: z.number().finite().min(0).optional(),
    loadCapacityKg: z.number().finite().min(0).optional(),
    year: z.number().int().min(1990).max(2035).optional(),
    fuelType: z.string().trim().max(30).optional(),
    seatingCapacity: z.number().int().min(1).max(100).optional(),
    registrationDate: z.iso.date().optional(),
    registrationExpiry: z.iso.date().optional(),
    isCommercial: z.boolean().optional(),
    permitDetails: z.string().trim().max(500).optional(),
  })
  .strict();

export type UpdateFleetVehicleInput = z.infer<typeof updateFleetVehicleSchema>;

export const fleetVehicleIdSchema = z.object({
  id: z.string().uuid('Invalid vehicle ID'),
});
