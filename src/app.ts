import cookieParser from 'cookie-parser';
import express from 'express';

import { errorMiddleware } from './common/middleware/error.middleware.js';

import { createAuthController } from './modules/auth/controllers/auth.controller.js';
import type { OtpProvider } from './modules/auth/providers/otp.provider.js';
import { createAuthRouter } from './modules/auth/routes/auth.routes.js';

import { UserController } from './modules/users/controllers/user.controller.js';
import type { UserRepository } from './modules/users/repositories/user.repository.js';
import { createUserRouter } from './modules/users/routes/user.routes.js';
import { UserService } from './modules/users/services/user.service.js';

export interface AppOptions {
  enableAuthRateLimiting?: boolean;
}

export function createApp(
  repository: UserRepository,
  otpProvider?: OtpProvider,
  options: AppOptions = {},
) {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

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

  const authController = createAuthController(otpProvider);

  app.use(
    '/auth',
    createAuthRouter(authController, {
      enableRateLimiting: options.enableAuthRateLimiting ?? true,
    }),
  );

  app.use(errorMiddleware);

  return app;
}