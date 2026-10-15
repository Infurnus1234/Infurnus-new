import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import type { AdminManagementService } from '../services/admin-management.service.js';
export function createAdminManagementRouter(service: AdminManagementService) {
  const router = Router();
  router.use(requireAuth, requireRoles('admin', 'super_admin'));
  router.get('/me', async (req, res, next) => {
    try {
      res.json({ success: true, data: await service.identity(req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  });
  router.use(requireRoles('super_admin'));
  router.get('/admins', async (req, res, next) => {
    try {
      const query = z
        .object({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          adminId: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.query);
      res.json({
        success: true,
        data: await service.list(req.auth!.userId, query.page, query.adminId),
      });
    } catch (error) {
      next(error);
    }
  });
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 30,
      keyGenerator: (req) => req.auth!.userId,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  router.post('/admins', async (req, res, next) => {
    try {
      res
        .status(201)
        .json({ success: true, data: await service.create(req.auth!.userId, req.body) });
    } catch (error) {
      next(error);
    }
  });
  router.patch('/admins/:id/status', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await service.setStatus(
          req.auth!.userId,
          z.string().uuid().parse(req.params.id),
          req.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  router.patch('/admins/:id/permissions', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await service.update(
          req.auth!.userId,
          z.string().uuid().parse(req.params.id),
          req.body,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
