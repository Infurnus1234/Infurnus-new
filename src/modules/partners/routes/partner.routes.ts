import { Router } from 'express';
import type { PartnerController } from '../controllers/partner.controller.js';

export function createPartnerRouter(controller: PartnerController) {
  const router = Router();
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.patch('/:id', controller.update);
  return router;
}
