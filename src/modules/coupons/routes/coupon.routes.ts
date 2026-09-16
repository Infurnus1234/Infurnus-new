import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { CouponController } from '../controllers/coupon.controller.js';

export function createCouponRouter(controller: CouponController) {
  const router = Router();

  router.use(requireAuth);

  router.post('/redeem', controller.redeem);

  return router;
}
