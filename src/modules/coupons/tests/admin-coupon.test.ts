import { describe, expect, it } from 'vitest';
import { adminCouponSchema } from '../schemas/admin-coupon.schema.js';
const valid = {
  code: ' TEST ',
  discountType: 'PERCENTAGE',
  discountValue: 12.5,
  maxDiscountAmount: 1000,
  minFareAmount: 0,
  usageLimit: 5,
  perUserLimit: 1,
  startsAt: '2026-01-01T00:00:00Z',
  expiresAt: '2026-02-01T00:00:00Z',
  isActive: false,
};
describe('administrative promo input', () => {
  it('normalizes codes and preserves explicit percentage/paise units', () =>
    expect(adminCouponSchema.parse(valid)).toMatchObject({
      code: 'TEST',
      discountValue: 12.5,
      maxDiscountAmount: 1000,
      isActive: false,
    }));
  for (const change of [
    { discountValue: 101 },
    { maxDiscountAmount: null },
    { discountType: 'FIXED', discountValue: 1.5, maxDiscountAmount: null },
    { discountType: 'FIXED', discountValue: 100 },
    { minFareAmount: -1 },
    { expiresAt: '2025-01-01T00:00:00Z' },
    { usageLimit: 0 },
    { unknown: 'not allowed' },
  ])
    it('rejects invalid coupon constraints ' + JSON.stringify(change), () =>
      expect(adminCouponSchema.safeParse({ ...valid, ...change }).success).toBe(false),
    );
  it('accepts an integer paise fixed discount', () =>
    expect(
      adminCouponSchema.safeParse({
        ...valid,
        discountType: 'FIXED',
        discountValue: 100,
        maxDiscountAmount: null,
      }).success,
    ).toBe(true));
});
