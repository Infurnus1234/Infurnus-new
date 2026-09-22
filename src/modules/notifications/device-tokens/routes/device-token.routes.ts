import { Router } from 'express';

import { requireAuth } from '../../../auth/middleware/auth.middleware.js';
import { DeviceTokenController } from '../controllers/device-token.controller.js';
import { DeviceTokenService } from '../services/device-token.service.js';

export function createDeviceTokenRouter(
  deviceTokenService: DeviceTokenService = new DeviceTokenService(),
): Router {
  const router = Router();

  const controller = new DeviceTokenController(deviceTokenService);

  router.post('/', requireAuth, controller.register);

  router.get('/', requireAuth, controller.list);

  router.patch('/:deviceId', requireAuth, controller.update);

  router.delete('/:deviceId', requireAuth, controller.deactivate);

  return router;
}
