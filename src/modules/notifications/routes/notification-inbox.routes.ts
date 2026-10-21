import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { AppError } from '../../../common/errors/app-error.js';
import { PostgresNotificationRepository } from '../repositories/notification.repository.js';

type InboxRepository = Pick<PostgresNotificationRepository, 'inbox' | 'readInbox'>;
export function createNotificationInboxRouter(
  repository: InboxRepository = new PostgresNotificationRepository(),
) {
  const router = Router();
  router.use(
    requireAuth,
    rateLimit({
      windowMs: 60000,
      limit: 120,
      keyGenerator: (req) => req.auth!.userId,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  router.get('/', async (req, res, next) => {
    try {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(25),
          offset: z.coerce.number().int().min(0).max(100000).default(0),
        })
        .strict()
        .parse(req.query);
      res.json({
        success: true,
        data: await repository.inbox(req.auth!.userId, query.limit, query.offset),
      });
    } catch (error) {
      next(error);
    }
  });
  router.patch('/read-all', async (req, res, next) => {
    try {
      res.json({ success: true, data: { updated: await repository.readInbox(req.auth!.userId) } });
    } catch (error) {
      next(error);
    }
  });
  router.patch('/:id/read', async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const updated = await repository.readInbox(req.auth!.userId, id);
      if (!updated) throw new AppError('NOTIFICATION_NOT_FOUND', 'Notification not found', 404);
      res.json({ success: true, data: { updated } });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
