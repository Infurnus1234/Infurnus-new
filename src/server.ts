import { createServer } from 'node:http';

import { GoogleMapsProvider } from './modules/rides/providers/google.maps.provider.js';
import { RouteRecalculationService } from './modules/rides/services/route-recalculation.service.js';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { checkDatabaseConnection, pool } from './infrastructure/database/postgres.js';
import { createSocketServer } from './infrastructure/socket/socket.server.js';

import { PostgresPartnerRepository } from './modules/partners/repositories/partner.repository.js';
import { PostgresPartnerDocumentRepository } from './modules/partners/repositories/partner-document.repository.js';

import { PostgresAdminRepository } from './modules/admin/repositories/admin.repository.js';
import { PostgresUserRepository } from './modules/users/repositories/user.repository.js';

import { PostgresVehicleRepository } from './modules/vehicles/repositories/vehicle.repository.js';

import { PostgresRideRepository } from './modules/rides/repositories/ride.repository.js';
import { PostgresDriverRepository } from './modules/rides/repositories/driver.repository.js';
import { DriverService } from './modules/rides/services/driver.service.js';
import { RideService } from './modules/rides/services/ride.service.js';

import { PostgresRentalRepository } from './modules/rentals/repositories/rental.repository.js';

import { SendmatorOtpProvider } from './modules/auth/providers/sendmator-otp.provider.js';
import { DevOtpProvider } from './modules/auth/providers/dev-otp.provider.js';

async function startServer() {
  // ==========================================================
  // Database
  // ==========================================================

  await checkDatabaseConnection();

  // ==========================================================
  // OTP provider
  // ==========================================================

  const otpProvider = env.SENDMATOR_API_KEY ? new SendmatorOtpProvider() : new DevOtpProvider();

  // ==========================================================
  // Repositories
  // ==========================================================

  const userRepository = new PostgresUserRepository(pool);

  const partnerRepository = new PostgresPartnerRepository(pool);

  const vehicleRepository = new PostgresVehicleRepository(pool);

  const partnerDocumentRepository = new PostgresPartnerDocumentRepository(pool);

  const adminRepository = new PostgresAdminRepository(pool);

  const rideRepository = new PostgresRideRepository(pool);

  const driverRepository = new PostgresDriverRepository(pool);

  const rentalRepository = new PostgresRentalRepository(pool);

  // ==========================================================
  // Express application
  //
  // authOtpProvider is passed explicitly as the 9th argument.
  // ==========================================================

  const app = createApp(
    userRepository,
    partnerRepository,
    vehicleRepository,
    partnerDocumentRepository,
    adminRepository,
    rideRepository,
    driverRepository,
    rentalRepository,
    otpProvider,
  );

  // ==========================================================
  // HTTP server
  // ==========================================================

  const server = createServer(app);

  // ==========================================================
  // Ride services
  // ==========================================================

  const rideService = new RideService(rideRepository, driverRepository);

  const driverService = new DriverService(driverRepository);

  const googleMapsProvider = new GoogleMapsProvider();

  const routeRecalculationService = new RouteRecalculationService(googleMapsProvider);

  // ==========================================================
  // Socket.IO
  // ==========================================================

  const io = createSocketServer(server, {
    driverService,
    rideRepository,
    rideService,
    routeRecalculationService,
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
  });

  // ==========================================================
  // Start server
  // ==========================================================

  server.listen(env.PORT, '0.0.0.0', () => {
    console.log(`INFURNUS API listening on port ${env.PORT} (0.0.0.0)`);
  });

  // ==========================================================
  // Graceful shutdown
  // ==========================================================

  const shutdown = async (signal: string) => {
    console.log(`${signal} received. Shutting down gracefully...`);

    server.close(async () => {
      await pool.end();

      console.log('INFURNUS API shut down.');

      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

// ============================================================
// Application startup
// ============================================================

startServer().catch(async (error: unknown) => {
  console.error('Failed to start INFURNUS API:', error);

  await pool.end();

  process.exit(1);
});
