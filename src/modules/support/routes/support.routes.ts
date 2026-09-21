import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { SupportController } from '../controllers/support.controller.js';

export function createSupportRouter(controller: SupportController): Router {
  const router = Router();

  router.use(requireAuth);

  router.post('/tickets', controller.createTicket);
  router.get('/tickets', controller.listTickets);
  router.get('/tickets/:id', controller.getTicket);

  return router;
}
