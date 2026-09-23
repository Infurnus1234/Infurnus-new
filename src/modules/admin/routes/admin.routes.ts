import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import type { AdminController } from '../controllers/admin.controller.js';

export function createAdminRouter(controller: AdminController) {
  const router = Router();
  router.use(requireAuth, requireRoles('admin', 'super_admin'));

  router.get('/users', controller.listUsers);
  router.get('/users/:id', controller.getUser);
  router.get('/partners', controller.listPartners);
  router.get('/partners/:id', controller.getPartner);
  router.get('/vehicles', controller.listVehicles);
  router.get('/vehicles/:id', controller.getVehicle);
  router.get('/dashboard', controller.dashboard);
  router.get('/reports/users', controller.listUsers);
  router.get('/reports/partners', controller.listPartners);
  router.get('/reports/vehicles', controller.listVehicles);

  // Fleet Analytics & Live Vehicle Management
  router.get('/fleet/analytics', controller.getFleetAnalyticsSummary);
  router.get('/fleet/states', controller.getStateFleetAnalytics);
  router.get('/fleet/states/:state/cities', controller.getCityFleetAnalytics);
  router.get('/fleet/map', controller.getLiveFleetVehicles);
  router.get('/fleet/vehicles', controller.getLiveFleetVehicles);
  router.get('/fleet/vehicles/:id', controller.getLiveFleetVehicleDetails);

  router.post('/drivers/:id/verify', controller.verifyDriver);
  router.post('/vehicles/:id/verify', controller.verifyVehicle);
  router.post('/documents/:id/verify', controller.verifyDocument);

  return router;
}
