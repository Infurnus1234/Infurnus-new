import { Router } from 'express';

import { requireAuth } from '../../auth/middleware/auth.middleware.js';

import {
  createRequiredSingleFileUpload,
  createRequiredMultipleFileUpload,
} from '../../../infrastructure/storage/multipart.js';

import type { PartnerDocumentStorageController } from '../controllers/partner-document-storage.controller.js';

export function createPartnerDocumentStorageRouter(controller: PartnerDocumentStorageController) {
  const router = Router({
    mergeParams: true,
  });

  router.use(requireAuth);

  router.post(
    '/upload',
    ...createRequiredSingleFileUpload({
      fieldName: 'file',
      maxFiles: 1,
    }),
    controller.upload,
  );

  router.post(
    '/:documentId/replace',
    ...createRequiredSingleFileUpload({
      fieldName: 'file',
      maxFiles: 1,
    }),
    controller.replace,
  );

  router.post(
    '/upload/pages',
    ...createRequiredMultipleFileUpload({ fieldName: 'files', maxFiles: 5 }),
    controller.upload,
  );
  router.post(
    '/:documentId/replace/pages',
    ...createRequiredMultipleFileUpload({ fieldName: 'files', maxFiles: 5 }),
    controller.replace,
  );
  router.get('/:documentId/pages/access-urls', controller.getPageAccessUrls);
  router.get('/:documentId/access-url', controller.getAccessUrl);

  router.delete('/:documentId', controller.delete);

  return router;
}
