import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import type { ProviderController } from '../controllers/provider.controller.js';

export function createProviderRouter(controller: ProviderController): Router {
  const router = Router();

  router.use(requireAuth);
  router.use(requireRoles('driver', 'fleet_owner', 'driver_fleet_owner', 'admin'));

  router.get('/bank-account', controller.getBankAccount);
  router.post('/bank-account', controller.upsertBankAccount);

  return router;
}
