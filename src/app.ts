import cookieParser from 'cookie-parser';
import express from 'express';

import { errorMiddleware } from './common/middleware/error.middleware.js';

import { createAuthController } from './modules/auth/controllers/auth.controller.js';
import type { OtpProvider } from './modules/auth/providers/otp.provider.js';
import { createAuthRouter } from './modules/auth/routes/auth.routes.js';

import { PartnerController } from './modules/partners/controllers/partner.controller.js';
import { PartnerService } from './modules/partners/services/partner.service.js';
import type { PartnerRepository } from './modules/partners/repositories/partner.repository.js';
import { createPartnerRouter } from './modules/partners/routes/partner.routes.js';

import { UserController } from './modules/users/controllers/user.controller.js';
import type { UserRepository } from './modules/users/repositories/user.repository.js';
import { createUserRouter } from './modules/users/routes/user.routes.js';
import { UserService } from './modules/users/services/user.service.js';

import { VehicleController } from './modules/vehicles/controllers/vehicle.controller.js';
import { VehicleService } from './modules/vehicles/services/vehicle.service.js';
import type { VehicleRepository } from './modules/vehicles/repositories/vehicle.repository.js';
import { createVehicleRouter } from './modules/vehicles/routes/vehicle.routes.js';

export interface AppOptions {
  enableAuthRateLimiting?: boolean;
}

export function createApp(
  repository?: UserRepository,
  partnerRepository?: PartnerRepository,
  vehicleRepository?: VehicleRepository,
): express.Express;

export function createApp(
  repository: UserRepository,
  otpProvider?: OtpProvider,
  options?: AppOptions,
): express.Express;

export function createApp(
  repository?: UserRepository,
  second?: PartnerRepository | OtpProvider,
  third?: VehicleRepository | AppOptions,
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

  let partnerRepository: PartnerRepository | undefined;
  let vehicleRepository: VehicleRepository | undefined;
  let otpProvider: OtpProvider | undefined;
  let options: AppOptions = {};

  if (second && 'sendEmailOtp' in second) {
    otpProvider = second;

    if (third && !('create' in third)) {
      options = third;
    }
  } else {
    partnerRepository = second;

    if (third && 'create' in third) {
      vehicleRepository = third;
    }
  }

  if (repository) {
    const controller = new UserController(new UserService(repository));
    app.use('/users', createUserRouter(controller));
  }

  if (partnerRepository) {
    const partnerController = new PartnerController(new PartnerService(partnerRepository));

    app.use('/partners', createPartnerRouter(partnerController));
  }

  if (vehicleRepository) {
    const vehicleController = new VehicleController(new VehicleService(vehicleRepository));

    app.use('/vehicles', createVehicleRouter(vehicleController));
  }

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
