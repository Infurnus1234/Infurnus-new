import { z } from 'zod';
import { rideStatuses } from '../types/ride.js';

const uuid = z.string().uuid();
const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);
const location = z.object({ latitude, longitude }).strict();

export const createRideSchema = z
  .object({
    pickup: location,
    destination: location,
    pickupAddress: z.string().trim().min(1).max(500).optional(),
    destinationAddress: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const rideIdSchema = z.object({ id: uuid }).strict();
export const rideStatusSchema = z.enum(rideStatuses);
export const cancelRideSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export const listRidesSchema = z
  .object({
    status: z.enum(rideStatuses).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().datetime().optional(),
  })
  .strict();

export type CreateRideInput = z.infer<typeof createRideSchema>;
export type CancelRideInput = z.infer<typeof cancelRideSchema>;
export type ListRidesInput = z.infer<typeof listRidesSchema>;
