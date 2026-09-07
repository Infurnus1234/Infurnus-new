import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { PartnerController } from '../controllers/partner.controller.js';

export function createPartnerRouter(controller: PartnerController) {
  const router = Router();
  router.use(requireAuth);
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.patch('/:id/availability', controller.updateAvailability);
  router.get('/:id', controller.getById);
  router.patch('/:id', controller.update);
  return router;
}
