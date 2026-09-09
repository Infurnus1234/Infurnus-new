import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import type { DriverController } from '../controllers/driver.controller.js';
import type { RideController } from '../controllers/ride.controller.js';

export function createRideRouter(controller: RideController, driverController?: DriverController) {
  const router = Router();
  router.use(requireAuth);
  if (driverController) {
    router.patch('/driver/availability', requireRoles('driver'), driverController.availability);
    router.post('/driver/location', requireRoles('driver'), driverController.location);
    router.post('/:id/accept', requireRoles('driver'), driverController.accept);
    router.post('/:id/complete', requireRoles('driver'), driverController.complete);
    router.post('/:id/status', requireRoles('driver'), driverController.transition);
  }
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/:id/cancel', controller.cancel);
  return router;
}
