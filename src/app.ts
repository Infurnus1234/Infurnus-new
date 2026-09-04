import express from 'express';
import { errorMiddleware } from './common/middleware/error.middleware.js';
import { UserController } from './modules/users/controllers/user.controller.js';
import { UserService } from './modules/users/services/user.service.js';
import { createUserRouter } from './modules/users/routes/user.routes.js';
import type { UserRepository } from './modules/users/repositories/user.repository.js';

export function createApp(repository: UserRepository) {
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

  const controller = new UserController(new UserService(repository));

  app.use('/users', createUserRouter(controller));

  app.use(errorMiddleware);

  return app;
}
