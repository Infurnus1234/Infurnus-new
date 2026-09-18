import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import type { DriverController } from '../controllers/driver.controller.js';
import type { RideController } from '../controllers/ride.controller.js';

export function createRideRouter(controller: RideController, driverController?: DriverController) {
  const router = Router();
  router.use(requireAuth);
  if (driverController) {
    router.get('/driver/profile', driverController.getProfile);
    router.post('/driver/profile', driverController.upsertProfile);
    router.get('/driver/history', requireRoles('driver'), driverController.history);
    router.patch('/driver/availability', requireRoles('driver'), driverController.availability);
    router.post('/driver/location', requireRoles('driver'), driverController.location);
    router.get('/driver/available', requireRoles('driver'), driverController.listAvailableRides);

    router.get('/driver/current-trip', requireRoles('driver'), driverController.getCurrentTrip);

    router.get('/driver/assigned-vehicle', requireRoles('driver'), driverController.getAssignedVehicle);
    router.post('/driver/assignment/verify-code', requireRoles('driver'), driverController.verifyAssignmentCode);
    router.post('/driver/assignment/claim-code', requireRoles('driver'), driverController.claimAssignmentCode);
    router.post('/driver/active-vehicle', requireRoles('driver'), driverController.setActiveVehicle);
    router.post('/:id/accept', requireRoles('driver'), driverController.accept);
    router.post('/:id/complete', requireRoles('driver'), driverController.complete);
    router.post('/:id/status', requireRoles('driver'), driverController.transition);
    router.post('/:id/verify-pin', requireRoles('driver'), driverController.verifyPin);

  }
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/:id/cancel', controller.cancel);
  return router;
}
