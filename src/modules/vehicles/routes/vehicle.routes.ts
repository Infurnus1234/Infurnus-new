import { loadServiceCities, registerServiceCity } from '../../maps/service-city-registry.js';
import { Router } from 'express';

import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireAdminOrSuperAdmin } from '../../auth/middleware/authorization.middleware.js';

import type { VehicleController } from '../controllers/vehicle.controller.js';

export function createVehicleRouter(controller: VehicleController) {
  const router = Router();

  // Every vehicle endpoint requires an authenticated user.
  router.use(requireAuth);

  router.get('/operating-cities', async (_req, res, next) => {
    try {
      res.json({ success: true, data: await loadServiceCities() });
    } catch (error) {
      next(error);
    }
  });
  router.post('/operating-cities', requireAdminOrSuperAdmin(), async (req, res, next) => {
    try {
      res
        .status(201)
        .json({ success: true, data: await registerServiceCity(req.body, req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  });

  // Vehicle creation
  router.post('/', requireAdminOrSuperAdmin(), controller.create);

  // Fleet listing must stay before /:id
  // so "fleet" is not interpreted as a vehicle UUID.
  router.get('/fleet', controller.getFleet);
  router.get('/catalog', controller.catalog);

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
