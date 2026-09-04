import { Router } from 'express';
import type { UserController } from '../controllers/user.controller.js';

export function createUserRouter(controller: UserController) {
  const router = Router();
  router.post('/', controller.create);
  router.get('/:id', controller.getById);
  router.patch('/:id', controller.update);
  router.post('/:id/addresses', controller.createAddress);
  router.patch('/:id/addresses/:addressId', controller.updateAddress);
  router.get('/:id/addresses', controller.getAddresses);
  router.get('/:id/preferences', controller.getPreferences);
  router.patch('/:id/preferences', controller.updatePreferences);
  return router;
}
