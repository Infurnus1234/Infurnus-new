import { createServer } from 'node:http';

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

async function startServer() {
  await checkDatabaseConnection();

  const app = createApp(
    new PostgresUserRepository(pool),
    new PostgresPartnerRepository(pool),
    new PostgresVehicleRepository(pool),
    new PostgresPartnerDocumentRepository(pool),
    new PostgresAdminRepository(pool),
    new PostgresRideRepository(pool),
    new PostgresDriverRepository(pool),
  );

  const server = createServer(app);
  const rideRepository = new PostgresRideRepository(pool);
  const driverRepository = new PostgresDriverRepository(pool);
  const rideService = new RideService(rideRepository, driverRepository);
  const driverService = new DriverService(driverRepository);
  const io = createSocketServer(server, {
    driverService,
    rideRepository,
    rideService,
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
  });

  server.listen(env.PORT, () => {
    console.log(`INFURNUS API listening on port ${env.PORT}`);
  });

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

startServer().catch(async (error: unknown) => {
  console.error('Failed to start INFURNUS API:', error);
  await pool.end();
  process.exit(1);
});
