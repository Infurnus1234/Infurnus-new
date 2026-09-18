import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { VehicleController } from '../controllers/vehicle.controller.js';

export function createVehicleRouter(controller: VehicleController) {
  const router = Router();
  router.use(requireAuth);
  router.post('/', controller.create);
  router.get('/fleet', controller.getFleet);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.patch('/:id', controller.update);
  router.post('/:id/deactivate', controller.deactivate);
  return router;
}
