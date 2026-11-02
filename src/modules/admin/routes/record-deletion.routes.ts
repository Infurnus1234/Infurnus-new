import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import {
  deletionModuleSchema,
  type RecordDeletionService,
} from '../services/record-deletion.service.js';
export function createRecordDeletionRouter(service: RecordDeletionService) {
  const router = Router();
  router.use(requireAuth, requireRoles('admin', 'super_admin'));
  router.delete('/:module/:id', async (req, res, next) => {
    try {
      const input = z
        .object({ reason: z.string().trim().min(5).max(500) })
        .strict()
        .parse(req.body);
      res.json({
        success: true,
        data: await service.remove(
          req.auth!.userId,
          req.auth!.role,
          deletionModuleSchema.parse(req.params.module),
          z.string().uuid().parse(req.params.id),
          input.reason,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
