import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import {
  requireRoles,
  requireFleetFinancialContext,
} from '../../auth/middleware/authorization.middleware.js';
import type { FleetController } from '../controllers/fleet.controller.js';

export function createFleetRouter(controller: FleetController): Router {
  const router = Router();

  router.use(requireAuth);
  router.use(requireRoles('fleet_owner', 'driver_fleet_owner', 'admin'));

  router.get('/vehicle-catalog', controller.catalog);
  router.get('/revenue', requireFleetFinancialContext(), controller.revenue);
  router.get('/vehicles/:id/revenue', requireFleetFinancialContext(), controller.revenue);
  router.get('/dashboard', requireFleetFinancialContext(), controller.getDashboard);
  router.get('/vehicles', controller.listVehicles);
  router.post('/vehicles', controller.createVehicle);
  router.put('/vehicles/:id', controller.updateVehicle);
  router.delete('/vehicles/:id', controller.deactivateVehicle);
  router.post(
    '/vehicles/:id/assignment-code',
    rateLimit({
      windowMs: 900000,
      limit: 20,
      keyGenerator: (req) => req.auth!.userId,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    controller.generateAssignmentCode,
  );
  router.post('/vehicles/:id/unassign', controller.unassignDriver);
  router.get('/drivers', controller.listDrivers);
  router.get('/trips', controller.listTrips);
  router.get('/earnings', requireFleetFinancialContext(), controller.getEarnings);

  return router;
}
