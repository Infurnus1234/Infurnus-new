import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { FareController } from '../controllers/fare.controller.js';

export function createFareRouter(controller: FareController) {
  const router = Router();

  router.use(requireAuth);

  router.post('/estimate', controller.estimate);

  return router;
}