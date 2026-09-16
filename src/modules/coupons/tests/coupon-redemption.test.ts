import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import type { Coupon, CouponRedemption } from '../types/coupon.js';
import type {
  CouponRepository,
  CreateCouponRedemptionInput,
} from '../repositories/coupon.repository.js';
import { CouponCalculatorService } from '../services/coupon-calculator.service.js';
import { CouponRedemptionService } from '../services/coupon-redemption.service.js';

vi.mock('../../../infrastructure/database/postgres.js', () => ({
  withTransaction: vi.fn(async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
    return callback({} as PoolClient);
  }),
}));

import { withTransaction } from '../../../infrastructure/database/postgres.js';

const mockedWithTransaction = vi.mocked(withTransaction);

const coupon: Coupon = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'SAVE20',
  discountType: 'PERCENTAGE',
  discountValue: 20,
  maxDiscountAmount: 5000,
  minFareAmount: 0,
  usageLimit: 100,
  perUserLimit: 2,
  startsAt: new Date('2026-09-01T00:00:00.000Z'),
  expiresAt: new Date('2026-10-01T00:00:00.000Z'),
  isActive: true,
  usageCount: 10,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};

const redemption: CouponRedemption = {
  id: '22222222-2222-4222-8222-222222222222',
  couponId: coupon.id,
  userId: '33333333-3333-4333-8333-333333333333',
  rideId: '44444444-4444-4444-8444-444444444444',
  couponCode: 'SAVE20',
  discountType: 'PERCENTAGE',
  discountValue: 20,
  fareBeforeDiscount: 10000,
  discountAmount: 2000,
  fareAfterDiscount: 8000,
  redeemedAt: new Date('2026-09-15T12:00:00.000Z'),
  createdAt: new Date('2026-09-15T12:00:00.000Z'),
};

function createRepositoryMock() {
  return {
    findByCode: vi.fn(),
    findByCodeForUpdate: vi.fn(),
    countUserRedemptions: vi.fn(),
    incrementUsage: vi.fn(),
    createRedemption: vi.fn(),
  } satisfies {
    [K in keyof CouponRepository]: ReturnType<typeof vi.fn>;
  };
}

describe('CouponRedemptionService', () => {
  let repository: ReturnType<typeof createRepositoryMock>;
  let calculator: CouponCalculatorService;
  let service: CouponRedemptionService;

  beforeEach(() => {
    vi.clearAllMocks();

    repository = createRepositoryMock();
    calculator = new CouponCalculatorService();

    service = new CouponRedemptionService(repository, calculator);

    mockedWithTransaction.mockImplementation(
      async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
        return callback({} as PoolClient);
      },
    );
  });

  describe('successful redemption', () => {
    it('redeems a valid coupon successfully', async () => {
      repository.findByCodeForUpdate.mockResolvedValue(coupon);
      repository.countUserRedemptions.mockResolvedValue(0);
      repository.incrementUsage.mockResolvedValue(true);
      repository.createRedemption.mockResolvedValue(redemption);

      const result = await service.redeem({
        couponCode: 'save20',
        userId: redemption.userId,
        rideId: redemption.rideId,
        fareAmount: 10000,
      });

      expect(result).toEqual(redemption);

      expect(repository.findByCodeForUpdate).toHaveBeenCalledWith('save20', expect.anything());

      expect(repository.countUserRedemptions).toHaveBeenCalledWith(
        coupon.id,
        redemption.userId,
        expect.anything(),
      );

      expect(repository.incrementUsage).toHaveBeenCalledWith(coupon.id, expect.anything());

      expect(repository.createRedemption).toHaveBeenCalledWith(
        {
          couponId: coupon.id,
          userId: redemption.userId,
          rideId: redemption.rideId,
          couponCode: 'SAVE20',
          discountType: 'PERCENTAGE',
          discountValue: 20,
          fareBeforeDiscount: 10000,
          discountAmount: 2000,
          fareAfterDiscount: 8000,
        },
        expect.anything(),
      );
    });

    it('normalizes the coupon code before lookup', async () => {
      repository.findByCodeForUpdate.mockResolvedValue(coupon);
      repository.countUserRedemptions.mockResolvedValue(0);
      repository.incrementUsage.mockResolvedValue(true);
      repository.createRedemption.mockResolvedValue(redemption);

      await service.redeem({
        couponCode: '  save20  ',
        userId: redemption.userId,
        rideId: redemption.rideId,
        fareAmount: 10000,
      });

      expect(repository.findByCodeForUpdate).toHaveBeenCalledWith('  save20  ', expect.anything());
    });

    it('stores the calculated financial snapshot', async () => {
      repository.findByCodeForUpdate.mockResolvedValue(coupon);
      repository.countUserRedemptions.mockResolvedValue(0);
      repository.incrementUsage.mockResolvedValue(true);
      repository.createRedemption.mockResolvedValue(redemption);

      await service.redeem({
        couponCode: coupon.code,
        userId: redemption.userId,
        rideId: redemption.rideId,
        fareAmount: 10000,
      });

      expect(repository.createRedemption).toHaveBeenCalledTimes(1);

      const createCall = repository.createRedemption.mock.calls[0]!;

      const input = createCall[0] as CreateCouponRedemptionInput;

      expect(input.fareBeforeDiscount).toBe(10000);
      expect(input.discountAmount).toBe(2000);
      expect(input.fareAfterDiscount).toBe(8000);
    });
  });

  describe('coupon lookup', () => {
    it('rejects an unknown coupon', async () => {
      repository.findByCodeForUpdate.mockResolvedValue(null);

      await expect(
        service.redeem({
          couponCode: 'UNKNOWN',
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).rejects.toThrow('Coupon not found');

      expect(repository.countUserRedemptions).not.toHaveBeenCalled();

      expect(repository.incrementUsage).not.toHaveBeenCalled();

      expect(repository.createRedemption).not.toHaveBeenCalled();
    });
  });

  describe('global usage limit', () => {
    it('rejects a coupon whose usage limit has been reached', async () => {
      repository.findByCodeForUpdate.mockResolvedValue({
        ...coupon,
        usageLimit: 10,
        usageCount: 10,
      });

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).rejects.toThrow('Coupon usage limit reached');

      expect(repository.countUserRedemptions).not.toHaveBeenCalled();

      expect(repository.incrementUsage).not.toHaveBeenCalled();

      expect(repository.createRedemption).not.toHaveBeenCalled();
    });

    it('allows redemption below the global usage limit', async () => {
      repository.findByCodeForUpdate.mockResolvedValue({
        ...coupon,
        usageLimit: 10,
        usageCount: 9,
      });
      repository.countUserRedemptions.mockResolvedValue(0);
      repository.incrementUsage.mockResolvedValue(true);
      repository.createRedemption.mockResolvedValue(redemption);

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).resolves.toEqual(redemption);

      expect(repository.incrementUsage).toHaveBeenCalledTimes(1);
    });

    it('supports unlimited global usage', async () => {
      repository.findByCodeForUpdate.mockResolvedValue({
        ...coupon,
        usageLimit: null,
        usageCount: 500,
      });
      repository.countUserRedemptions.mockResolvedValue(0);
      repository.incrementUsage.mockResolvedValue(true);
      repository.createRedemption.mockResolvedValue(redemption);

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).resolves.toEqual(redemption);
    });
  });

  describe('per-user usage limit', () => {
    it('rejects when the user has reached the per-user limit', async () => {
      repository.findByCodeForUpdate.mockResolvedValue(coupon);
      repository.countUserRedemptions.mockResolvedValue(2);

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).rejects.toThrow('Coupon per-user usage limit reached');

      expect(repository.incrementUsage).not.toHaveBeenCalled();

      expect(repository.createRedemption).not.toHaveBeenCalled();
    });

    it('allows redemption below the per-user limit', async () => {
      repository.findByCodeForUpdate.mockResolvedValue(coupon);
      repository.countUserRedemptions.mockResolvedValue(1);
      repository.incrementUsage.mockResolvedValue(true);
      repository.createRedemption.mockResolvedValue(redemption);

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).resolves.toEqual(redemption);
    });

    it('supports unlimited per-user usage', async () => {
      repository.findByCodeForUpdate.mockResolvedValue({
        ...coupon,
        perUserLimit: null,
      });
      repository.countUserRedemptions.mockResolvedValue(1000);
      repository.incrementUsage.mockResolvedValue(true);
      repository.createRedemption.mockResolvedValue(redemption);

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).resolves.toEqual(redemption);
    });
  });

  describe('calculation failure', () => {
    it('does not increment usage when calculation fails', async () => {
      repository.findByCodeForUpdate.mockResolvedValue({
        ...coupon,
        minFareAmount: 20000,
      });
      repository.countUserRedemptions.mockResolvedValue(0);

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).rejects.toThrow('Minimum fare of 20000 paise is required for coupon SAVE20');

      expect(repository.incrementUsage).not.toHaveBeenCalled();

      expect(repository.createRedemption).not.toHaveBeenCalled();
    });
  });

  describe('usage increment protection', () => {
    it('rejects when the database usage increment fails', async () => {
      repository.findByCodeForUpdate.mockResolvedValue(coupon);
      repository.countUserRedemptions.mockResolvedValue(0);
      repository.incrementUsage.mockResolvedValue(false);

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).rejects.toThrow('Coupon usage limit reached');

      expect(repository.createRedemption).not.toHaveBeenCalled();
    });

    it('does not create a redemption when usage increment fails', async () => {
      repository.findByCodeForUpdate.mockResolvedValue(coupon);
      repository.countUserRedemptions.mockResolvedValue(0);
      repository.incrementUsage.mockResolvedValue(false);

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).rejects.toThrow();

      expect(repository.createRedemption).not.toHaveBeenCalled();
    });
  });

  describe('transaction behavior', () => {
    it('executes the redemption inside withTransaction', async () => {
      repository.findByCodeForUpdate.mockResolvedValue(coupon);
      repository.countUserRedemptions.mockResolvedValue(0);
      repository.incrementUsage.mockResolvedValue(true);
      repository.createRedemption.mockResolvedValue(redemption);

      await service.redeem({
        couponCode: coupon.code,
        userId: redemption.userId,
        rideId: redemption.rideId,
        fareAmount: 10000,
      });

      expect(mockedWithTransaction).toHaveBeenCalledTimes(1);

      expect(mockedWithTransaction).toHaveBeenCalledWith(expect.any(Function));
    });

    it('propagates transaction failures', async () => {
      const transactionError = new Error('database transaction failed');

      mockedWithTransaction.mockRejectedValue(transactionError);

      await expect(
        service.redeem({
          couponCode: coupon.code,
          userId: redemption.userId,
          rideId: redemption.rideId,
          fareAmount: 10000,
        }),
      ).rejects.toThrow('database transaction failed');
    });
  });

  describe('operation ordering', () => {
    it('locks, checks usage, increments, then creates redemption', async () => {
      const calls: string[] = [];

      repository.findByCodeForUpdate.mockImplementation(async () => {
        calls.push('lock');
        return coupon;
      });

      repository.countUserRedemptions.mockImplementation(async () => {
        calls.push('count');
        return 0;
      });

      repository.incrementUsage.mockImplementation(async () => {
        calls.push('increment');
        return true;
      });

      repository.createRedemption.mockImplementation(async () => {
        calls.push('create');
        return redemption;
      });

      await service.redeem({
        couponCode: coupon.code,
        userId: redemption.userId,
        rideId: redemption.rideId,
        fareAmount: 10000,
      });

      expect(calls).toEqual(['lock', 'count', 'increment', 'create']);
    });
  });
});
