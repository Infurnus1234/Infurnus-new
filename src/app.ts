import express from 'express';
import { errorMiddleware } from './common/middleware/error.middleware.js';
import { UserController } from './modules/users/controllers/user.controller.js';
import { UserService } from './modules/users/services/user.service.js';
import { createUserRouter } from './modules/users/routes/user.routes.js';
import type { UserRepository } from './modules/users/repositories/user.repository.js';
import { PartnerController } from './modules/partners/controllers/partner.controller.js';
import { PartnerService } from './modules/partners/services/partner.service.js';
import { createPartnerRouter } from './modules/partners/routes/partner.routes.js';
import type { PartnerRepository } from './modules/partners/repositories/partner.repository.js';

export function createApp(repository?: UserRepository, partnerRepository?: PartnerRepository) {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
      },
    });
  });

  if (repository) {
    const controller = new UserController(new UserService(repository));
    app.use('/users', createUserRouter(controller));
  }

  if (partnerRepository) {
    const partnerController = new PartnerController(new PartnerService(partnerRepository));
    app.use('/partners', createPartnerRouter(partnerController));
  }

  app.use(errorMiddleware);

  return app;
}
