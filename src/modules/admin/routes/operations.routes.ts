import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import {
  AdminOperationsRepository,
  operationSources,
  operationModuleSchema,
  operationQuerySchema,
} from '../repositories/operations.repository.js';
export function createAdminOperationsRouter(repository: AdminOperationsRepository) {
  const router = Router();
  router.use(requireAuth, requireRoles('admin', 'super_admin'));
  router.use(async (req, _res, next) => {
    try {
      await repository.authorize(req.auth!.userId, req.auth!.role);
      next();
    } catch (error) {
      next(error);
    }
  });
  router.patch('/support/:id/status', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      res.json({ success: true, data: await repository.updateSupportStatus(id, req.body) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/coupons', async (req, res, next) => {
    try {
      res
        .status(201)
        .json({ success: true, data: await repository.manageCoupon(req.auth!.userId, req.body) });
    } catch (error) {
      next(error);
    }
  });
  router.patch('/coupons/:id/active', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      res.json({
        success: true,
        data: await repository.manageCoupon(req.auth!.userId, req.body, id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/summary', async (req, res, next) => {
    try {
      const query = z
        .object({ from: z.string().date().optional(), to: z.string().date().optional() })
        .strict()
        .refine((q) => !q.from || !q.to || q.from <= q.to, 'Invalid date range')
        .parse(req.query);
      res.json({
        success: true,
        data: await repository.summary(query.from, query.to, req.auth!.role === 'super_admin'),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/:module', async (req, res, next) => {
    try {
      const module = operationModuleSchema.parse(req.params.module);
      // Existing finance infrastructure is exposed read-only to Super Admin. No gateway calls.
      if (
        [
          'commission',
          'refunds',
          'payments',
          'wallets',
          'transactions',
          'settlements',
          'activity',
        ].includes(module) &&
        req.auth!.role !== 'super_admin'
      ) {
        res.status(403).json({ success: false, error: { message: 'Super Admin access required' } });
        return;
      }
      const query = operationQuerySchema.parse(req.query);
      if (
        query.status &&
        !(operationSources[module].statuses as readonly string[]).includes(query.status)
      ) {
        res
          .status(400)
          .json({ success: false, error: { message: 'Invalid status for this module' } });
        return;
      }
      res.json({ success: true, data: await repository.list(module, query) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
