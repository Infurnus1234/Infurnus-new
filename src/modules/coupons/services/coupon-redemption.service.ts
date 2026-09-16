import { withTransaction } from "../../../infrastructure/database/postgres.js";
import type { CouponRepository } from "../repositories/coupon.repository.js";
import { CouponCalculatorService } from "./coupon-calculator.service.js";
import type { CouponRedemption } from "../types/coupon.js";

export interface RedeemCouponInput {
  couponCode: string;
  userId: string;
  rideId: string;
  fareAmount: number;
}

export class CouponRedemptionService {
  constructor(
    private readonly couponRepository: CouponRepository,
    private readonly couponCalculator: CouponCalculatorService,
  ) {}

  async redeem(
    input: RedeemCouponInput,
  ): Promise<CouponRedemption> {
    return withTransaction(async (client) => {
      /*
       * Lock the coupon row before checking usage.
       *
       * This serializes concurrent redemption attempts for the
       * same coupon and prevents two requests from both observing
       * the same remaining usage capacity.
       */
      const coupon =
        await this.couponRepository.findByCodeForUpdate(
          input.couponCode,
          client,
        );

      if (!coupon) {
        throw new Error("Coupon not found");
      }

      /*
       * Usage limits are checked inside the transaction after
       * acquiring the coupon row lock.
       */
      if (
        coupon.usageLimit !== null &&
        coupon.usageCount >= coupon.usageLimit
      ) {
        throw new Error("Coupon usage limit reached");
      }

      const userRedemptionCount =
        await this.couponRepository.countUserRedemptions(
          coupon.id,
          input.userId,
          client,
        );

      if (
        coupon.perUserLimit !== null &&
        userRedemptionCount >= coupon.perUserLimit
      ) {
        throw new Error(
          "Coupon per-user usage limit reached",
        );
      }

      /*
       * Pure financial calculation remains isolated from
       * database state.
       */
      const calculation =
        this.couponCalculator.calculate(
          input.fareAmount,
          coupon,
        );

      /*
       * Increment the usage counter only after all validation
       * has succeeded.
       *
       * The database condition provides a second protection
       * against exceeding the configured global usage limit.
       */
      const usageIncremented =
        await this.couponRepository.incrementUsage(
          coupon.id,
          client,
        );

      if (!usageIncremented) {
        throw new Error("Coupon usage limit reached");
      }

      /*
       * Store the immutable financial snapshot.
       */
      return this.couponRepository.createRedemption(
        {
          couponId: coupon.id,
          userId: input.userId,
          rideId: input.rideId,
          couponCode: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          fareBeforeDiscount:
            calculation.fareBeforeDiscount,
          discountAmount: calculation.discountAmount,
          fareAfterDiscount:
            calculation.fareAfterDiscount,
        },
        client,
      );
    });
  }
}