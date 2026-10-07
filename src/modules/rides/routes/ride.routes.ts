import rateLimit from 'express-rate-limit';
import { env } from '../../../config/env.js';
import { Router } from 'express';

import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';

import {
  createRequiredSingleFileUpload,
  createRequiredMultipleFileUpload,
} from '../../../infrastructure/storage/multipart.js';

import type { DriverController } from '../controllers/driver.controller.js';
import type { RideController } from '../controllers/ride.controller.js';

export function createRideRouter(controller: RideController, driverController?: DriverController) {
  const router = Router();

  router.use(requireAuth);
  const mapLimit = rateLimit({
    windowMs: 60000,
    limit: env.MAP_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.auth!.userId,
  });

  if (driverController) {
    // ==========================================================
    // Driver Profile
    // ==========================================================

    router.get('/driver/profile', requireRoles('driver'), driverController.getProfile);

    router.post('/driver/profile', requireRoles('driver'), driverController.upsertProfile);

    // ==========================================================
    // Driver Documents
    // ==========================================================

    router.post(
      '/driver/documents/:documentType',
      requireRoles('driver'),
      mapLimit,
      ...createRequiredSingleFileUpload({
        fieldName: 'file',
      }),
      driverController.uploadDocument,
    );

    router.post(
      '/driver/documents/:documentType/pages',
      requireRoles('driver'),
      mapLimit,
      ...createRequiredMultipleFileUpload({ fieldName: 'files', maxFiles: 5 }),
      driverController.uploadDocumentPages,
    );

    router.get(
      '/driver/documents/:documentId/pages/access-urls',
      requireRoles('driver'),
      driverController.getDocumentPageAccessUrls,
    );

    router.get('/driver/documents', requireRoles('driver'), driverController.listDocuments);

    router.get(
      '/driver/documents/:documentId',
      requireRoles('driver'),
      driverController.getDocument,
    );

    router.get(
      '/driver/documents/:documentId/access-url',
      requireRoles('driver'),
      driverController.getDocumentAccessUrl,
    );

    router.delete(
      '/driver/documents/:documentId',
      requireRoles('driver'),
      driverController.deleteDocument,
    );

    // ==========================================================
    // Driver Rides
    // ==========================================================

    router.get('/driver/history', requireRoles('driver'), driverController.history);

    router.patch('/driver/availability', requireRoles('driver'), driverController.availability);

    router.post('/driver/location', requireRoles('driver'), driverController.location);

    router.get('/driver/available', requireRoles('driver'), driverController.listAvailableRides);

    router.post('/driver/available/:id/decline', requireRoles('driver'), driverController.decline);

    router.get('/driver/rides/:id/map', requireRoles('driver'), mapLimit, driverController.map);

    router.get('/driver/current-trip', requireRoles('driver'), driverController.getCurrentTrip);

    // ==========================================================
    // Driver Vehicle
    // ==========================================================

    router.get(
      '/driver/assigned-vehicle',
      requireRoles('driver'),
      driverController.getAssignedVehicle,
    );

    router.post(
      '/driver/assignment/verify-code',
      requireRoles('driver'),
      driverController.verifyAssignmentCode,
    );

    router.post(
      '/driver/assignment/claim-code',
      requireRoles('driver'),
      driverController.claimAssignmentCode,
    );

    router.post(
      '/driver/active-vehicle',
      requireRoles('driver'),
      driverController.setActiveVehicle,
    );

    // ==========================================================
    // Driver Ride Actions
    // ==========================================================

    router.post('/:id/accept', requireRoles('driver'), driverController.accept);

    router.post('/:id/complete', requireRoles('driver'), driverController.complete);

    router.post('/:id/status', requireRoles('driver'), driverController.transition);

    router.post('/:id/verify-pin', requireRoles('driver'), driverController.verifyPin);
  }

  // ==========================================================
  // Customer Rides
  // ==========================================================

  router.post('/', controller.create);

  router.get('/', controller.list);

  router.get('/:id/map', mapLimit, controller.map);
  router.post('/:id/location', mapLimit, controller.location);
  router.get('/:id', controller.getById);

  router.post('/:id/cancel', controller.cancel);

  return router;
}
