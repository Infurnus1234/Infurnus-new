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
  return router;
}
