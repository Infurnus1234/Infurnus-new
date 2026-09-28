import { Router } from 'express';

import { requireAuth } from '../../auth/middleware/auth.middleware.js';

import type { PartnerVehicleController } from '../controllers/partner-vehicle.controller.js';

export function createPartnerVehicleRouter(controller: PartnerVehicleController) {
  const router = Router();

  router.use(requireAuth);

  router.get('/', controller.list);

  router.post('/', controller.create);

  router.put('/:id', controller.update);

  router.delete('/:id', controller.deactivate);

  return router;
}
