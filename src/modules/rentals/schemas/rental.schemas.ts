import { z } from 'zod';
import { rentalStatuses } from '../types/rental.js';

const uuid = z.string().uuid();

export const createRentalSchema = z
  .object({
    vehicleId: uuid,
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    totalAmount: z.number().finite().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = new Date(value.startAt);
    const end = new Date(value.endAt);

    if (end <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'endAt must be after startAt',
      });
    }
  });

export const rentalIdSchema = z.object({ id: uuid }).strict();

export const cancelRentalSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const rentalStatusSchema = z.enum(rentalStatuses);

export const listRentalsSchema = z
  .object({
    status: rentalStatusSchema.optional(),
    vehicleId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type CreateRentalInput = z.infer<typeof createRentalSchema>;
export type CancelRentalInput = z.infer<typeof cancelRentalSchema>;
export type ListRentalsInput = z.infer<typeof listRentalsSchema>;
