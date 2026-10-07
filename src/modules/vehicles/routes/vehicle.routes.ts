import { Router } from 'express';

import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireAdminOrSuperAdmin } from '../../auth/middleware/authorization.middleware.js';

import type { VehicleController } from '../controllers/vehicle.controller.js';

export function createVehicleRouter(controller: VehicleController) {
  const router = Router();

  // Every vehicle endpoint requires an authenticated user.
  router.use(requireAuth);

  // Vehicle creation
  router.post('/', requireAdminOrSuperAdmin(), controller.create);

  // Fleet listing must stay before /:id
  // so "fleet" is not interpreted as a vehicle UUID.
  router.get('/fleet', controller.getFleet);

  // Driver-specific vehicle listing
  router.get('/', controller.list);

  // Single vehicle
  router.get('/:id', controller.getById);

  // Vehicle update
  router.patch('/:id', requireAdminOrSuperAdmin(), controller.update);

  // Vehicle deactivation
  router.post('/:id/deactivate', requireAdminOrSuperAdmin(), controller.deactivate);

  return router;
}
