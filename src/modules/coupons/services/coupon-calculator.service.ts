import type { Coupon, CouponCalculationResult } from '../types/coupon.js';

const MAX_SAFE_MONEY = Number.MAX_SAFE_INTEGER;

/**
 * Calculates the discount for a coupon without performing redemption.
 *
 * Responsibilities:
 * - Validate coupon configuration relevant to calculation
 * - Validate fare amount
 * - Validate coupon activation/expiry window
 * - Enforce minimum fare
 * - Calculate percentage/fixed discount
 * - Apply maximum discount cap
 * - Never allow discount > fare
 * - Return integer paise
 *
 * Usage limits are intentionally NOT checked here.
 * Those require database state and must be enforced transactionally
 * by the redemption service.
 */
export class CouponCalculatorService {
  calculate(fareAmount: number, coupon: Coupon, now: Date = new Date()): CouponCalculationResult {
    this.validateFare(fareAmount);
    this.validateCoupon(coupon);
    this.validateAvailability(coupon, now);

    if (fareAmount < coupon.minFareAmount) {
      throw new Error(
        `Minimum fare of ${coupon.minFareAmount} paise is required for coupon ${coupon.code}`,
      );
    }

    let discountAmount: number;

    if (coupon.discountType === 'PERCENTAGE') {
      discountAmount = this.calculatePercentageDiscount(fareAmount, coupon.discountValue);

      if (coupon.maxDiscountAmount !== null) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
      }
    } else {
      discountAmount = coupon.discountValue;
    }

    discountAmount = Math.min(discountAmount, fareAmount);

    this.assertSafeMoney(discountAmount, 'discountAmount');

    const fareAfterDiscount = fareAmount - discountAmount;

    this.assertSafeMoney(fareAfterDiscount, 'fareAfterDiscount');

    return {
      fareBeforeDiscount: fareAmount,
      discountAmount,
      fareAfterDiscount,
      currency: 'INR',
    };
  }

  private calculatePercentageDiscount(fareAmount: number, percentage: number): number {
    const discount = (fareAmount * percentage) / 100;

    if (!Number.isFinite(discount) || discount < 0) {
      throw new Error('Invalid percentage discount calculation');
    }

    return Math.round(discount);
  }

  private validateFare(fareAmount: number): void {
    if (!Number.isSafeInteger(fareAmount)) {
      throw new Error('fareAmount must be a safe integer in paise');
    }

    if (fareAmount < 0) {
      throw new Error('fareAmount cannot be negative');
    }
  }

  private validateCoupon(coupon: Coupon): void {
    if (!coupon.id.trim()) {
      throw new Error('Coupon id cannot be empty');
    }

    if (!coupon.code.trim()) {
      throw new Error('Coupon code cannot be empty');
    }

    if (!Number.isFinite(coupon.discountValue)) {
      throw new Error('Invalid coupon discount value');
    }

    if (coupon.discountValue <= 0) {
      throw new Error('Coupon discount value must be greater than zero');
    }

    if (coupon.discountType === 'PERCENTAGE' && coupon.discountValue > 100) {
      throw new Error('Percentage discount cannot exceed 100');
    }

    if (
      coupon.maxDiscountAmount !== null &&
      (!Number.isSafeInteger(coupon.maxDiscountAmount) || coupon.maxDiscountAmount <= 0)
    ) {
      throw new Error('Invalid maximum discount amount');
    }

    if (!Number.isSafeInteger(coupon.minFareAmount)) {
      throw new Error('minFareAmount must be a safe integer in paise');
    }

    if (coupon.minFareAmount < 0) {
      throw new Error('minFareAmount cannot be negative');
    }

    if (
      coupon.usageLimit !== null &&
      (!Number.isSafeInteger(coupon.usageLimit) || coupon.usageLimit <= 0)
    ) {
      throw new Error('Invalid usage limit');
    }

    if (
      coupon.perUserLimit !== null &&
      (!Number.isSafeInteger(coupon.perUserLimit) || coupon.perUserLimit <= 0)
    ) {
      throw new Error('Invalid per-user usage limit');
    }

    if (!Number.isSafeInteger(coupon.usageCount)) {
      throw new Error('usageCount must be a safe integer');
    }

    if (coupon.usageCount < 0) {
      throw new Error('usageCount cannot be negative');
    }

    if (coupon.usageLimit !== null && coupon.usageCount > coupon.usageLimit) {
      throw new Error('Coupon usage count exceeds configured usage limit');
    }

    if (coupon.discountType === 'PERCENTAGE') {
      if (coupon.maxDiscountAmount === null) {
        throw new Error('Percentage coupon requires a maximum discount amount');
      }
    }

    if (coupon.discountType === 'FIXED' && coupon.maxDiscountAmount !== null) {
      throw new Error('Fixed coupon cannot define a maximum discount amount');
    }
  }

  private validateAvailability(coupon: Coupon, now: Date): void {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error('Invalid current time');
    }

    if (!coupon.isActive) {
      throw new Error('Coupon is inactive');
    }

    if (now < coupon.startsAt) {
      throw new Error('Coupon is not active yet');
    }

    if (coupon.expiresAt !== null && now >= coupon.expiresAt) {
      throw new Error('Coupon has expired');
    }
  }

  private assertSafeMoney(amount: number, fieldName: string): void {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_SAFE_MONEY) {
      throw new Error(`Calculated ${fieldName} exceeds supported monetary range`);
    }
  }
}
