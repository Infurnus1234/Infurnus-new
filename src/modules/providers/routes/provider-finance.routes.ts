import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireProvider } from '../../auth/middleware/authorization.middleware.js';
import type { PostgresProviderFinanceRepository } from '../repositories/provider-finance.repository.js';

const payoutSchema = z
  .object({
    amountPaise: z.number().int().positive().max(9999999999),
    idempotencyKey: z.string().trim().min(1).max(100),
  })
  .strict();

export function createProviderFinanceRouter(repository: PostgresProviderFinanceRepository) {
  const router = Router();
  router.use(
    requireAuth,
    requireProvider(),
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => req.auth!.userId,
    }),
  );
  router.get('/wallet', async (req, res, next) => {
    try {
      res.json({ success: true, data: await repository.wallet(req.auth!.userId, req.auth!.role) });
    } catch (error) {
      next(error);
    }
  });
  router.get('/payouts', async (req, res, next) => {
    try {
      res.json({ success: true, data: await repository.payouts(req.auth!.userId, req.auth!.role) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/payouts', async (req, res, next) => {
    try {
      const input = payoutSchema.parse(req.body);
      res.status(201).json({
        success: true,
        data: await repository.requestPayout(
          req.auth!.userId,
          req.auth!.role,
          input.amountPaise,
          input.idempotencyKey,
        ),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
