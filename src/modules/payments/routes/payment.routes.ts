import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { PaymentController } from '../controllers/payment.controller.js';

export function createPaymentRouter(controller: PaymentController): Router {
  const router = Router();

  router.use(requireAuth);

  router.post('/initiate', controller.initiate);
  router.post('/:paymentId/capture', controller.capture);
  router.get('/history', controller.listHistory);
  router.get('/:paymentId', controller.getById);

  return router;
}
