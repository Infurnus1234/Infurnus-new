import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { PartnerDocumentController } from '../controllers/partner-document.controller.js';

export function createPartnerDocumentRouter(controller: PartnerDocumentController) {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.patch('/:documentId', controller.update);
  return router;
}
