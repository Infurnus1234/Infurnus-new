import { z } from 'zod';
const paise = z.number().int().min(0).max(9999999999);
export const adminCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .transform((v) => v.toUpperCase()),
    discountType: z.enum(['PERCENTAGE', 'FIXED']),
    discountValue: z.number().finite().positive().max(99999999.99),
    maxDiscountAmount: paise.positive().nullable(),
    minFareAmount: paise,
    usageLimit: z.number().int().positive().max(2147483647).nullable(),
    perUserLimit: z.number().int().positive().max(2147483647).nullable(),
    startsAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    isActive: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.discountType === 'PERCENTAGE' && (v.discountValue > 100 || v.maxDiscountAmount === null))
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'Percentage must be at most 100 and requires a maximum discount cap in paise',
      });
    if (
      v.discountType === 'FIXED' &&
      (!Number.isInteger(v.discountValue) || v.maxDiscountAmount !== null)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'Fixed discount must use integer paise with no percentage cap',
      });
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(v.discountValue)))
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'At most two decimal places',
      });
    if (v.expiresAt && Date.parse(v.expiresAt) <= Date.parse(v.startsAt))
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry must be after start' });
  });
export type AdminCouponInput = z.infer<typeof adminCouponSchema>;
export const couponActivationSchema = z
  .object({
    isActive: z.boolean(),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Valid version timestamp required'),
  })
  .strict();
