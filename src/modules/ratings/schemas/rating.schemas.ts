import { z } from 'zod';

const uuid = z.string().uuid();

export const createRatingSchema = z
  .object({
    rideId: uuid,
    rating: z.number().int().min(1).max(5),
    review: z.string().trim().max(1000).optional(),
  })
  .strict();

export const driverRatingQuerySchema = z
  .object({
    driverProfileId: uuid,
  })
  .strict();

export type CreateRatingInput = z.infer<typeof createRatingSchema>;
