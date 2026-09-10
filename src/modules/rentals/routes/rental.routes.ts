import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { RentalController } from '../controllers/rental.controller.js';

export function createRentalRouter(controller: RentalController) {
  const router = Router();

  router.use(requireAuth);

  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/:id/cancel', controller.cancel);

  return router;
}
