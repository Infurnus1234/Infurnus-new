import express, { type ErrorRequestHandler, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from './common/errors/app-error.js';
import { UserController } from './modules/users/controllers/user.controller.js';
import { createUserRouter } from './modules/users/routes/user.routes.js';
import { UserService } from './modules/users/services/user.service.js';
import type { UserRepository } from './modules/users/repositories/user.repository.js';

export function createApp(repository: UserRepository) {
  const app = express();
  app.use(express.json());

  const controller = new UserController(new UserService(repository));
  app.use('/users', createUserRouter(controller));
  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (error, _request, response, next: NextFunction) => {
  void next;
  if (error instanceof ZodError) {
    response.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }

  response.status(500).json({
    success: false,
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
  });
};
