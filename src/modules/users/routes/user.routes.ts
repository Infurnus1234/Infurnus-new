import { Router } from 'express';
import type { UserController } from '../controllers/user.controller.js';

export function createUserRouter(controller: UserController) {
  const router = Router();
  router.post('/', controller.create);
  router.get('/:id', controller.getById);
  router.patch('/:id', controller.update);
  return router;
}
