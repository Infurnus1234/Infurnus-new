import { z } from 'zod';

const uuid = z.string().uuid();

export const redeemCouponSchema = z
  .object({
    couponCode: z.string().trim().min(1).max(100),
    rideId: uuid,
    fareAmount: z.number().int().safe().nonnegative(),
  })
  .strict();

export const couponCodeSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
  })
  .strict();

export type RedeemCouponInput = z.infer<typeof redeemCouponSchema>;
