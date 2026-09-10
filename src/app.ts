import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { errorMiddleware } from './common/middleware/error.middleware.js';
import { env } from './config/env.js';

import { createAuthController } from './modules/auth/controllers/auth.controller.js';
import type { OtpProvider } from './modules/auth/providers/otp.provider.js';
import { createAuthRouter } from './modules/auth/routes/auth.routes.js';

import { PartnerController } from './modules/partners/controllers/partner.controller.js';
import type { PartnerRepository } from './modules/partners/repositories/partner.repository.js';
import { createPartnerRouter } from './modules/partners/routes/partner.routes.js';
import { PartnerService } from './modules/partners/services/partner.service.js';
import { PartnerDocumentController } from './modules/partners/controllers/partner-document.controller.js';
import type { PartnerDocumentRepository } from './modules/partners/repositories/partner-document.repository.js';
import { createPartnerDocumentRouter } from './modules/partners/routes/partner-document.routes.js';
import { PartnerDocumentService } from './modules/partners/services/partner-document.service.js';

import { UserController } from './modules/users/controllers/user.controller.js';
import type { UserRepository } from './modules/users/repositories/user.repository.js';
import { createUserRouter } from './modules/users/routes/user.routes.js';
import { UserService } from './modules/users/services/user.service.js';

import { VehicleController } from './modules/vehicles/controllers/vehicle.controller.js';
import type { VehicleRepository } from './modules/vehicles/repositories/vehicle.repository.js';
import { createVehicleRouter } from './modules/vehicles/routes/vehicle.routes.js';
import { VehicleService } from './modules/vehicles/services/vehicle.service.js';
import { AdminController } from './modules/admin/controllers/admin.controller.js';
import type { AdminRepository } from './modules/admin/repositories/admin.repository.js';
import { createAdminRouter } from './modules/admin/routes/admin.routes.js';
import { AdminService } from './modules/admin/services/admin.service.js';
import { RideController } from './modules/rides/controllers/ride.controller.js';
import type { RideRepository } from './modules/rides/repositories/ride.repository.js';
import { createRideRouter } from './modules/rides/routes/ride.routes.js';
import { RideService } from './modules/rides/services/ride.service.js';
import { DriverController } from './modules/rides/controllers/driver.controller.js';
import type { DriverRepository } from './modules/rides/repositories/driver.repository.js';
import { DriverService } from './modules/rides/services/driver.service.js';
import { RentalController } from './modules/rentals/controllers/rental.controller.js';
import type { RentalRepository } from './modules/rentals/repositories/rental.repository.js';
import { createRentalRouter } from './modules/rentals/routes/rental.routes.js';
import { RentalService } from './modules/rentals/services/rental.service.js';

export interface AppOptions {
  enableAuthRateLimiting?: boolean;
  enableAuthCsrfProtection?: boolean;
}

export function createApp(
  repository?: UserRepository,
  partnerRepository?: PartnerRepository,
  vehicleRepository?: VehicleRepository,
  partnerDocumentRepository?: PartnerDocumentRepository,
  adminRepository?: AdminRepository,
  rideRepository?: RideRepository,
  driverRepository?: DriverRepository,
  rentalRepository?: RentalRepository,
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
  partnerDocumentRepository?: PartnerDocumentRepository,
  adminRepository?: AdminRepository,
  rideRepository?: RideRepository,
  driverRepository?: DriverRepository,
  rentalRepository?: RentalRepository,
) {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || origin === env.CORS_ORIGIN) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
      credentials: env.CORS_CREDENTIALS,
    }),
  );

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

  if (partnerDocumentRepository) {
    const documentController = new PartnerDocumentController(
      new PartnerDocumentService(partnerDocumentRepository),
    );

    app.use('/partners/:id/documents', createPartnerDocumentRouter(documentController));
  }

  if (vehicleRepository) {
    const vehicleController = new VehicleController(new VehicleService(vehicleRepository));

    app.use('/vehicles', createVehicleRouter(vehicleController));
  }

  if (adminRepository) {
    app.use('/admin', createAdminRouter(new AdminController(new AdminService(adminRepository))));
  }

  if (rideRepository) {
    const rideService = new RideService(rideRepository, driverRepository);
    const driverController = driverRepository
      ? new DriverController(new DriverService(driverRepository), rideService)
      : undefined;
    app.use('/rides', createRideRouter(new RideController(rideService), driverController));
  }

  if (rentalRepository) {
    const rentalController = new RentalController(new RentalService(rentalRepository));
    app.use('/rentals', createRentalRouter(rentalController));
  }

  const authController = createAuthController(otpProvider);

  app.use(
    '/auth',
    createAuthRouter(authController, {
      enableRateLimiting: options.enableAuthRateLimiting ?? true,
      enableCsrfProtection: options.enableAuthCsrfProtection ?? true,
    }),
  );

  app.use(errorMiddleware);

  return app;
}
