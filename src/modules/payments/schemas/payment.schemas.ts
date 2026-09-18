import { z } from 'zod';

const uuid = z.string().uuid();

export const initiatePaymentSchema = z
  .object({
    rideId: uuid.optional(),
    rentalId: uuid.optional(),
    logisticsOrderId: uuid.optional(),
    amount: z.number().positive().optional(),
    currency: z.string().default('INR').optional(),
    provider: z.enum(['wallet', 'cash', 'upi', 'card', 'razorpay']).default('wallet'),
    idempotencyKey: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .refine(
    (data) => {
      const count =
        (data.rideId ? 1 : 0) +
        (data.rentalId ? 1 : 0) +
        (data.logisticsOrderId ? 1 : 0);
      return count === 1;
    },
    { message: 'Exactly one of rideId, rentalId, or logisticsOrderId must be provided' },
  );

export const capturePaymentSchema = z
  .object({
    providerPaymentId: z.string().trim().max(255).optional(),
  })
  .strict();

export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;
export type CapturePaymentInput = z.infer<typeof capturePaymentSchema>;
