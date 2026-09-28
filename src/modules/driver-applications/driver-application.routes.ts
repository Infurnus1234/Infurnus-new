import { Router } from 'express';

import { requireAuth } from '../auth/middleware/auth.middleware.js';
import { requireAdminOrSuperAdmin } from '../auth/middleware/authorization.middleware.js';

import { pool } from '../../infrastructure/database/postgres.js';

import { DriverApplicationController } from './driver-application.controller.js';
import { DriverApplicationService } from './driver-application.service.js';
import { PostgresDriverApplicationRepository } from './driver-application.repository.js';

import { PostgresPartnerDriverRepository } from '../partners/repositories/partner-driver.repository.js';

import { PostgresPartnerRepository } from '../partners/repositories/partner.repository.js';

import { PostgresDriverRepository } from '../rides/repositories/driver.repository.js';

export function createDriverApplicationRouter(service?: DriverApplicationService) {
  const applicationService =
    service ??
    new DriverApplicationService(
      new PostgresDriverApplicationRepository(),
      new PostgresPartnerDriverRepository(pool),
      new PostgresPartnerRepository(pool),
      new PostgresDriverRepository(pool),
    );

  const controller = new DriverApplicationController(applicationService);

  const router = Router();

  router.use(requireAuth);

  router.post('/', controller.create);

  router.get('/', controller.list);

  router.get('/driver/:driverProfileId', controller.getByDriverProfile);

  router.get('/:id', controller.getById);

  router.post('/:id/review', requireAdminOrSuperAdmin(), controller.review);

  return router;
}

export const driverApplicationRouter = createDriverApplicationRouter();
