import { Router } from 'express';
import { requireAuth } from '../../auth/middleware/auth.middleware.js';
import type { WalletController } from '../controllers/wallet.controller.js';

export function createWalletRouter(controller: WalletController): Router {
  const router = Router();

  // All wallet operations require authenticated user
  router.get('/', requireAuth, controller.getWallet);
  router.get('/history', requireAuth, controller.getHistory);
  router.post('/topup/initiate', requireAuth, controller.initiateTopUp);
  router.post('/topup/verify', requireAuth, controller.verifyTopUp);
  router.post('/pay', requireAuth, controller.pay);
  router.post('/resolve-recipient', requireAuth, controller.resolveRecipient);

  return router;
}
