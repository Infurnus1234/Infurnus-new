import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { PaymentController } from '../controllers/payment.controller.js';

export function createPaymentRouter(controller: PaymentController): Router {
  const router = Router();

  // Public webhook route: verified strictly via Cashfree HMAC-SHA256 signature
  router.post('/webhooks/cashfree', controller.handleCashfreeWebhook);

  // Authenticated customer/admin routes
  router.post('/initiate', requireAuth, controller.initiate);
  router.post('/:paymentId/capture', requireAuth, controller.capture);
  router.post('/:paymentId/refund', requireAuth, controller.refund);
  router.get('/history', requireAuth, controller.listHistory);
  router.get('/:paymentId', requireAuth, controller.getById);

  return router;
}
