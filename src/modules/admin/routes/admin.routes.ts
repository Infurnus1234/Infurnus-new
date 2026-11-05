import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../../infrastructure/database/postgres.js';
import { ProviderIdentityRepository } from '../../providers/repositories/provider-identity.repository.js';

import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';

import type { AdminController } from '../controllers/admin.controller.js';

export function createAdminRouter(controller: AdminController) {
  const router = Router();

  router.use(requireAuth, requireRoles('admin', 'super_admin'), controller.authorize);
  const identities = new ProviderIdentityRepository(pool);
  router.get(
    '/provider-identities/capacity',
    requireRoles('super_admin'),
    async (_req, res, next) => {
      try {
        res.json({ success: true, data: await identities.capacity() });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/provider-identities/length',
    requireRoles('super_admin'),
    async (req, res, next) => {
      try {
        const { length } = z
          .object({ length: z.number().int().min(6).max(64) })
          .strict()
          .parse(req.body);
        res.json({
          success: true,
          data: await identities.activateLength(length, req.auth!.userId),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get('/provider-identities/:publicId', async (req, res, next) => {
    try {
      const id = z
        .string()
        .regex(/^[1-9][0-9]{5,63}$/)
        .parse(req.params.publicId);
      res.json({ success: true, data: await identities.lookup(id, req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  });

  // Physical /vehicles inventory endpoints retain their existing meaning.
  router.post('/vehicle-types', controller.createVehicleType);
  router.get('/vehicle-types', controller.listVehicleTypes);
  router.get('/vehicle-types/:id', controller.getVehicleType);
  router.patch('/vehicle-types/:id', controller.updateVehicleType);
  router.patch('/vehicle-types/:id/status', controller.updateVehicleTypeStatus);

  router.get('/users', controller.listUsers);
  router.get('/users/:id', controller.getUser);
  router.patch('/users/:id/status', controller.updateUserStatus);

  // Driver Management
  router.get('/drivers/applications', controller.listDriverApplications);

  // Driver application review MUST come before /drivers/:id
  router.post('/drivers/applications/:id/review', controller.reviewDriverApplication);

  router.get('/drivers', controller.listDrivers);
  router.get('/drivers/:id/documents/:documentId/access-url', controller.driverDocumentAccess);
  router.get('/drivers/:id', controller.getDriver);

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
