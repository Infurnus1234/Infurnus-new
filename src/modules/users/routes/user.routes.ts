import { Router } from 'express';

import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { UserController } from '../controllers/user.controller.js';
import { requireSelf } from '../middleware/user-access.middleware.js';

export function createUserRouter(controller: UserController) {
  const router = Router();

  // User profile
  router.get('/:id', requireAuth, requireSelf, controller.getById);
  router.patch('/:id', requireAuth, requireSelf, controller.update);
  router.delete('/:id', requireAuth, requireSelf, controller.deleteAccount);

  // User addresses
  router.post('/:id/addresses', requireAuth, requireSelf, controller.createAddress);
  router.patch('/:id/addresses/:addressId', requireAuth, requireSelf, controller.updateAddress);
  router.get('/:id/addresses', requireAuth, requireSelf, controller.getAddresses);

  // User preferences
  router.get('/:id/preferences', requireAuth, requireSelf, controller.getPreferences);
  router.patch('/:id/preferences', requireAuth, requireSelf, controller.updatePreferences);

  // User history
  router.get('/:id/history', requireAuth, requireSelf, controller.getHistory);

  return router;
}
