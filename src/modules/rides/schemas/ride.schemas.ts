import { z } from 'zod';
import { rideStatuses } from '../types/ride.js';

const uuid = z.string().uuid();

const latitude = z.number().finite().min(-90).max(90);

const longitude = z.number().finite().min(-180).max(180);

const location = z
  .object({
    latitude,
    longitude,
  })
  .strict();

export const createRideSchema = z
  .object({
    pickup: location,
    destination: location,
    pickupAddress: z.string().trim().min(1).max(500).optional(),
    destinationAddress: z.string().trim().min(1).max(500).optional(),
    fareEstimate: z.number().positive().optional(),
    sector: z.enum(['passenger', 'logistics', 'service', 'premium']).optional(),
    vehicleCategory: z.string().trim().min(1).max(50).optional(),
    goods: z
      .object({
        itemType: z.string().trim().min(1).max(100).optional(),
        weightKg: z.number().nonnegative().optional(),
        quantity: z.number().int().positive().optional(),
        hasLoadingAssistance: z.boolean().optional(),
      })
      .optional(),
    serviceDetails: z
      .object({
        serviceType: z.enum(['ambulance', 'towing', 'jcb', 'recovery']).optional(),
        emergencyLevel: z.string().optional(),
        workHours: z.number().positive().optional(),
        notes: z.string().optional(),
      })
      .optional(),
    rentalDetails: z
      .object({
        startDate: z.string().optional(),
        startTime: z.string().optional(),
        hours: z.number().positive().optional(),
        fuelRatePerKm: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  .strict();

export const fareEstimateSchema = z
  .object({
    pickup: location,
    destination: location,
    sector: z.enum(['passenger', 'logistics', 'service', 'premium']).optional(),
    vehicleCategory: z.string().trim().min(1).max(50).optional(),
    waitingMinutes: z.number().nonnegative().optional(),
    weightKg: z.number().nonnegative().optional(),
    hasLoadingAssistance: z.boolean().optional(),
    rentalHours: z.number().positive().optional(),
    fuelRatePerKm: z.number().nonnegative().optional(),
    goods: z
      .object({
        itemType: z.string().trim().min(1).max(100).optional(),
        weightKg: z.number().nonnegative().optional(),
        quantity: z.number().int().positive().optional(),
        hasLoadingAssistance: z.boolean().optional(),
      })
      .optional(),
    serviceDetails: z
      .object({
        serviceType: z.string().optional(),
        emergencyLevel: z.string().optional(),
        workHours: z.number().positive().optional(),
        notes: z.string().optional(),
      })
      .optional(),
    rentalDetails: z
      .object({
        startDate: z.string().optional(),
        startTime: z.string().optional(),
        hours: z.number().positive().optional(),
        fuelRatePerKm: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  .strict();

export const rideIdSchema = z.object({ id: uuid }).strict();

export const rideStatusSchema = z.enum(rideStatuses);

export const cancelRideSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const listRidesSchema = z
  .object({
    status: z.enum(rideStatuses).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().datetime().optional(),
  })
  .strict();

export type CreateRideInput = z.infer<typeof createRideSchema>;

export type FareEstimateInput = z.infer<typeof fareEstimateSchema>;

export type CancelRideInput = z.infer<typeof cancelRideSchema>;

export type ListRidesInput = z.infer<typeof listRidesSchema>;
