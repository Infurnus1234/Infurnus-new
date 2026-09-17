import { describe, expect, it } from 'vitest';

import { CouponCalculatorService } from '../services/coupon-calculator.service.js';
import type { Coupon } from '../types/coupon.js';

const calculator = new CouponCalculatorService();

const NOW = new Date('2026-09-15T12:00:00.000Z');

function createCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'SAVE20',
    discountType: 'PERCENTAGE',
    discountValue: 20,
    maxDiscountAmount: 5000,
    minFareAmount: 0,
    usageLimit: null,
    perUserLimit: null,
    startsAt: new Date('2026-09-01T00:00:00.000Z'),
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    isActive: true,
    usageCount: 0,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('CouponCalculatorService', () => {
  describe('percentage discounts', () => {
    it('calculates a percentage discount correctly', () => {
      const coupon = createCoupon({
        discountValue: 20,
        maxDiscountAmount: 5000,
      });

      const result = calculator.calculate(10000, coupon, NOW);

      expect(result).toEqual({
        fareBeforeDiscount: 10000,
        discountAmount: 2000,
        fareAfterDiscount: 8000,
        currency: 'INR',
      });
    });

    it('applies the maximum discount cap', () => {
      const coupon = createCoupon({
        discountValue: 50,
        maxDiscountAmount: 3000,
      });

      const result = calculator.calculate(10000, coupon, NOW);

      expect(result.discountAmount).toBe(3000);
      expect(result.fareAfterDiscount).toBe(7000);
    });

    it('allows the full 100 percent discount', () => {
      const coupon = createCoupon({
        discountValue: 100,
        maxDiscountAmount: 10000,
      });

      const result = calculator.calculate(10000, coupon, NOW);

      expect(result.discountAmount).toBe(10000);
      expect(result.fareAfterDiscount).toBe(0);
    });

    it('rounds percentage discount to the nearest paise', () => {
      const coupon = createCoupon({
        discountValue: 33.33,
        maxDiscountAmount: 10000,
      });

      const result = calculator.calculate(10001, coupon, NOW);

      expect(result.discountAmount).toBe(3333);
      expect(result.fareAfterDiscount).toBe(6668);
    });

    it('does not exceed the fare even when the percentage calculation would', () => {
      const coupon = createCoupon({
        discountValue: 100,
        maxDiscountAmount: 50000,
      });

      const result = calculator.calculate(10000, coupon, NOW);

      expect(result.discountAmount).toBe(10000);
      expect(result.fareAfterDiscount).toBe(0);
    });
  });

  describe('fixed discounts', () => {
    it('calculates a fixed discount correctly', () => {
      const coupon = createCoupon({
        discountType: 'FIXED',
        discountValue: 1000,
        maxDiscountAmount: null,
      });

      const result = calculator.calculate(5000, coupon, NOW);

      expect(result).toEqual({
        fareBeforeDiscount: 5000,
        discountAmount: 1000,
        fareAfterDiscount: 4000,
        currency: 'INR',
      });
    });

    it('does not allow a fixed discount to exceed the fare', () => {
      const coupon = createCoupon({
        discountType: 'FIXED',
        discountValue: 10000,
        maxDiscountAmount: null,
      });

      const result = calculator.calculate(5000, coupon, NOW);

      expect(result.discountAmount).toBe(5000);
      expect(result.fareAfterDiscount).toBe(0);
    });

    it('supports a fixed discount equal to the fare', () => {
      const coupon = createCoupon({
        discountType: 'FIXED',
        discountValue: 5000,
        maxDiscountAmount: null,
      });

      const result = calculator.calculate(5000, coupon, NOW);

      expect(result.discountAmount).toBe(5000);
      expect(result.fareAfterDiscount).toBe(0);
    });
  });

  describe('minimum fare', () => {
    it('rejects a fare below the minimum requirement', () => {
      const coupon = createCoupon({
        minFareAmount: 10000,
      });

      expect(() => calculator.calculate(9999, coupon, NOW)).toThrow(
        'Minimum fare of 10000 paise is required for coupon SAVE20',
      );
    });

    it('accepts a fare exactly equal to the minimum', () => {
      const coupon = createCoupon({
        minFareAmount: 10000,
        discountValue: 20,
        maxDiscountAmount: 5000,
      });

      const result = calculator.calculate(10000, coupon, NOW);

      expect(result.discountAmount).toBe(2000);
    });
  });

  describe('coupon availability', () => {
    it('rejects an inactive coupon', () => {
      const coupon = createCoupon({
        isActive: false,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow('Coupon is inactive');
    });

    it('rejects a coupon that has not started', () => {
      const coupon = createCoupon({
        startsAt: new Date('2026-09-20T00:00:00.000Z'),
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow('Coupon is not active yet');
    });

    it('accepts a coupon exactly at its start time', () => {
      const coupon = createCoupon({
        startsAt: NOW,
      });

      const result = calculator.calculate(10000, coupon, NOW);

      expect(result.discountAmount).toBe(2000);
    });

    it('rejects an expired coupon', () => {
      const coupon = createCoupon({
        expiresAt: new Date('2026-09-15T11:59:59.999Z'),
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow('Coupon has expired');
    });

    it('rejects a coupon exactly at its expiry time', () => {
      const coupon = createCoupon({
        expiresAt: NOW,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow('Coupon has expired');
    });

    it('accepts a coupon immediately before expiry', () => {
      const coupon = createCoupon({
        expiresAt: new Date('2026-09-15T12:00:00.001Z'),
      });

      const result = calculator.calculate(10000, coupon, NOW);

      expect(result.discountAmount).toBe(2000);
    });
  });

  describe('invalid fare input', () => {
    it('rejects a negative fare', () => {
      const coupon = createCoupon();

      expect(() => calculator.calculate(-1, coupon, NOW)).toThrow('fareAmount cannot be negative');
    });

    it('rejects a fractional fare', () => {
      const coupon = createCoupon();

      expect(() => calculator.calculate(1000.5, coupon, NOW)).toThrow(
        'fareAmount must be a safe integer in paise',
      );
    });

    it('rejects an unsafe fare', () => {
      const coupon = createCoupon();

      expect(() => calculator.calculate(Number.MAX_SAFE_INTEGER + 1, coupon, NOW)).toThrow(
        'fareAmount must be a safe integer in paise',
      );
    });
  });

  describe('invalid coupon configuration', () => {
    it('rejects an empty coupon id', () => {
      const coupon = createCoupon({
        id: ' ',
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow('Coupon id cannot be empty');
    });

    it('rejects an empty coupon code', () => {
      const coupon = createCoupon({
        code: ' ',
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow('Coupon code cannot be empty');
    });

    it('rejects a zero discount', () => {
      const coupon = createCoupon({
        discountValue: 0,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow(
        'Coupon discount value must be greater than zero',
      );
    });

    it('rejects a negative discount', () => {
      const coupon = createCoupon({
        discountValue: -10,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow(
        'Coupon discount value must be greater than zero',
      );
    });

    it('rejects percentage discounts above 100', () => {
      const coupon = createCoupon({
        discountValue: 100.01,
        maxDiscountAmount: 5000,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow(
        'Percentage discount cannot exceed 100',
      );
    });

    it('rejects a percentage coupon without a maximum discount', () => {
      const coupon = createCoupon({
        discountType: 'PERCENTAGE',
        maxDiscountAmount: null,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow(
        'Percentage coupon requires a maximum discount amount',
      );
    });

    it('rejects a fixed coupon with a maximum discount', () => {
      const coupon = createCoupon({
        discountType: 'FIXED',
        discountValue: 1000,
        maxDiscountAmount: 5000,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow(
        'Fixed coupon cannot define a maximum discount amount',
      );
    });

    it('rejects a negative minimum fare', () => {
      const coupon = createCoupon({
        minFareAmount: -1,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow(
        'minFareAmount cannot be negative',
      );
    });

    it('rejects an invalid usage limit', () => {
      const coupon = createCoupon({
        usageLimit: 0,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow('Invalid usage limit');
    });

    it('rejects an invalid per-user usage limit', () => {
      const coupon = createCoupon({
        perUserLimit: 0,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow(
        'Invalid per-user usage limit',
      );
    });

    it('rejects usage count above the configured limit', () => {
      const coupon = createCoupon({
        usageLimit: 10,
        usageCount: 11,
      });

      expect(() => calculator.calculate(10000, coupon, NOW)).toThrow(
        'Coupon usage count exceeds configured usage limit',
      );
    });
  });

  describe('time validation', () => {
    it('rejects an invalid current date', () => {
      const coupon = createCoupon();
      const invalidDate = new Date('invalid');

      expect(() => calculator.calculate(10000, coupon, invalidDate)).toThrow(
        'Invalid current time',
      );
    });
  });
});
