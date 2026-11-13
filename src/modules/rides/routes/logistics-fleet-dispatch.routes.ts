import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import { requireRoles } from '../../auth/middleware/authorization.middleware.js';
import { PostgresProviderOperationsRepository } from '../../providers/repositories/provider-operations.repository.js';
import { LogisticsTargetedDispatch } from '../services/logistics-targeted-dispatch.js';

export function createLogisticsFleetDispatchRouter(pool: Pool) {
  const router = Router();
  const dispatch = new LogisticsTargetedDispatch(pool);
  const accounts = new PostgresProviderOperationsRepository(pool);
  const id = z.string().uuid();
  router.use(requireAuth, requireRoles('fleet_owner', 'driver_fleet_owner'));
  router.use(async (req, res, next) => {
    await accounts.authorize(req.auth!.userId, req.auth!.role);
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', async (req, res) => {
    res.json({ success: true, data: await dispatch.fleetOffers(req.auth!.userId) });
  });
  router.post('/:offerId/respond', async (req, res) => {
    const { accept } = z.object({ accept: z.boolean() }).strict().parse(req.body);
    await dispatch.fleetRespond(req.auth!.userId, id.parse(req.params.offerId), accept);
    res.json({ success: true });
  });
  router.get('/:offerId/candidates', async (req, res) => {
    res.json({
      success: true,
      data: await dispatch.fleetCandidates(req.auth!.userId, id.parse(req.params.offerId)),
    });
  });
  router.post('/:offerId/forward', async (req, res) => {
    const { driverId, vehicleId } = z
      .object({ driverId: id, vehicleId: id })
      .strict()
      .parse(req.body);
    const offer = await dispatch.fleetForward(
      req.auth!.userId,
      id.parse(req.params.offerId),
      driverId,
      vehicleId,
    );
    res.status(201).json({ success: true, data: offer });
  });
  return router;
}
