import type { NextFunction, Request, Response } from 'express';
import { redeemCouponSchema } from '../schemas/coupon.schemas.js';
import type { CouponRedemptionService } from '../services/coupon-redemption.service.js';

export class CouponController {
  constructor(private readonly couponRedemptionService: CouponRedemptionService) {}

  redeem = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = redeemCouponSchema.parse(req.body);

      const redemption = await this.couponRedemptionService.redeem({
        couponCode: input.couponCode,
        userId: req.auth!.userId,
        rideId: input.rideId,
        fareAmount: input.fareAmount,
      });

      res.json({
        success: true,
        data: redemption,
        message: 'Coupon redeemed',
      });
    } catch (error) {
      next(error);
    }
  };
}
