import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { RatingController } from '../controllers/rating.controller.js';

export function createRatingRouter(controller: RatingController): Router {
  const router = Router();

  router.use(requireAuth);

  router.post('/', controller.create);
  router.get('/ride/:rideId', controller.getByRide);
  router.get('/driver/:driverProfileId', controller.getDriverSummary);

  return router;
}
