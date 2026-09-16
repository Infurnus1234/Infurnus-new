/**
 * Coupon domain types.
 *
 * Coupon v1 supports:
 * - Percentage discounts
 * - Fixed-amount discounts
 * - Maximum discount caps
 * - Minimum fare requirements
 * - Global usage limits
 * - Per-user usage limits
 * - Start/expiry windows
 *
 * All monetary values are represented as integer minor units (paise).
 */

export const COUPON_CURRENCY = "INR" as const;

export type CouponCurrency = typeof COUPON_CURRENCY;

export const COUPON_DISCOUNT_TYPES = [
  "PERCENTAGE",
  "FIXED",
] as const;

export type CouponDiscountType =
  (typeof COUPON_DISCOUNT_TYPES)[number];

/**
 * Coupon definition stored in the database.
 */
export interface Coupon {
  id: string;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  minFareAmount: number;
  usageLimit: number | null;
  perUserLimit: number | null;
  startsAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input used by the coupon calculation engine.
 *
 * fareAmount is the gross fare before applying the coupon.
 */
export interface CouponCalculationInput {
  fareAmount: number;
  coupon: Coupon;
  now?: Date;
}

/**
 * Result of applying a coupon to a fare.
 */
export interface CouponCalculationResult {
  fareBeforeDiscount: number;
  discountAmount: number;
  fareAfterDiscount: number;
  currency: CouponCurrency;
}

/**
 * Immutable redemption snapshot.
 *
 * These values preserve exactly what was applied to the ride,
 * even if the coupon configuration changes later.
 */
export interface CouponRedemption {
  id: string;
  couponId: string;
  userId: string;
  rideId: string;

  couponCode: string;
  discountType: CouponDiscountType;
  discountValue: number;

  fareBeforeDiscount: number;
  discountAmount: number;
  fareAfterDiscount: number;

  redeemedAt: Date;
  createdAt: Date;
}