import { attachProviderTracking } from './modules/providers/services/provider-tracking.socket.js';
import { loadDeletedSubjects } from './modules/auth/services/deleted-subjects.js';
import { PostgresProviderOperationsRepository } from './modules/providers/repositories/provider-operations.repository.js';
import { PostgresProviderFinanceRepository } from './modules/providers/repositories/provider-finance.repository.js';
import { AppError } from './common/errors/app-error.js';
import { CommonMapService } from './modules/maps/map.service.js';
import { RedisMapCache } from './modules/maps/map.cache.js';
import { createServer } from 'node:http';
import {
  respondWhileStandby,
  waitForBackendInstance,
} from './infrastructure/database/backend-standby.js';
import { GoogleMapsProvider } from './modules/rides/providers/google.maps.provider.js';
import { RouteRecalculationService } from './modules/rides/services/route-recalculation.service.js';
import { createApp } from './app.js';
import { localStorageProvider } from './infrastructure/storage/index.js';
import { env } from './config/env.js';
import { createConfiguredOtpProvider } from './modules/auth/providers/otp-provider.factory.js';
import {
  acquireBackendInstance,
  checkDatabaseConnection,
  pool,
} from './infrastructure/database/postgres.js';
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
import { MatchingService } from './modules/rides/services/matching.service.js';

import { PostgresRentalRepository } from './modules/rentals/repositories/rental.repository.js';

import { serviceArea } from './modules/maps/service-area.js';

import { FareCalculatorService } from './modules/fares/services/fare-calculator.service.js';
import { FareEstimateService } from './modules/fares/services/fare-estimate.service.js';

import { PostgresCouponRepository } from './modules/coupons/repositories/coupon.repository.js';
import { CouponCalculatorService } from './modules/coupons/services/coupon-calculator.service.js';
import { CouponRedemptionService } from './modules/coupons/services/coupon-redemption.service.js';

import { PostgresRatingRepository } from './modules/ratings/repositories/rating.repository.js';
import { PostgresPaymentRepository } from './modules/payments/repositories/payment.repository.js';
import { CashfreePaymentProvider } from './modules/payments/providers/cashfree.provider.js';
import { PostgresFleetRepository } from './modules/fleet/repositories/fleet.repository.js';
import { PostgresProviderBankRepository } from './modules/providers/repositories/provider-bank.repository.js';
import { PostgresSupportRepository } from './modules/support/repositories/support.repository.js';

let releaseInstance: (() => Promise<void>) | undefined;

async function startServer() {
  // ==========================================================
  // Database
  // ==========================================================

  await checkDatabaseConnection();

  // Push delivery is optional for the API. Loading the worker eagerly requires
  // Redis and Firebase even when neither service is configured locally.
  const notifications =
    env.REDIS_URL && env.FIREBASE_PROJECT_ID
      ? await import('./infrastructure/queue/index.js')
      : undefined;

  if (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') {
    await serviceArea.assertSupported([]);

    if (!env.GOOGLE_MAPS_API_KEY?.trim()) {
      throw new AppError(
        'MAP_PROVIDER_NOT_CONFIGURED',
        'Map provider credentials are not configured',
        503,
      );
    }
  }

  // ==========================================================
  // OTP provider
  // ==========================================================

  const otpProvider = createConfiguredOtpProvider(pool);

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

  const couponRepository = new PostgresCouponRepository(pool);

  const ratingRepository = new PostgresRatingRepository(pool);

  const paymentRepository = new PostgresPaymentRepository(pool);

  const cashfreePaymentProvider =
    env.CASHFREE_CLIENT_ID && env.CASHFREE_CLIENT_SECRET
      ? new CashfreePaymentProvider({
          clientId: env.CASHFREE_CLIENT_ID,
          clientSecret: env.CASHFREE_CLIENT_SECRET,
          apiVersion: env.CASHFREE_API_VERSION,
          baseUrl:
            env.CASHFREE_ENV === 'production' &&
            env.CASHFREE_BASE_URL === 'https://sandbox.cashfree.com/pg'
              ? 'https://api.cashfree.com/pg'
              : env.CASHFREE_BASE_URL,
        })
      : undefined;

  const fleetRepository = new PostgresFleetRepository(pool);

  const providerBankRepository = new PostgresProviderBankRepository(pool);

  const supportRepository = new PostgresSupportRepository(pool);

  // ==========================================================
  // Map provider
  //
  // One provider instance is shared by:
  // - Fare estimation
  // - Route recalculation
  // - Socket.IO ride infrastructure
  // ==========================================================

  let mapCache: RedisMapCache | undefined;

  if (env.REDIS_URL) {
    const { redis, connectRedis } = await import('./infrastructure/redis/index.js');

    void connectRedis().catch(() => console.warn('Map Redis unavailable; cache fallback active'));

    mapCache = new RedisMapCache(redis);
  }

  const googleMapsProvider = new CommonMapService(
    new GoogleMapsProvider(env.GOOGLE_MAPS_API_KEY, fetch, Date.now, (event, metadata) =>
      console.info(JSON.stringify({ event, ...metadata })),
    ),
    mapCache,
  );

  // ==========================================================
  // Fare services
  // ==========================================================

  const fareCalculatorService = new FareCalculatorService();

  const fareEstimateService = new FareEstimateService(
    googleMapsProvider,
    fareCalculatorService,
    undefined,
    vehicleRepository,
  );

  // ==========================================================
  // Coupon services
  //
  // Coupon redemption is transaction-backed and uses the
  // PostgreSQL repository with row-level locking.
  // ==========================================================

  const couponCalculatorService = new CouponCalculatorService();

  const couponRedemptionService = new CouponRedemptionService(
    couponRepository,
    couponCalculatorService,
  );

  // ==========================================================
  // Express application
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
    fareEstimateService,
    couponRedemptionService,
    ratingRepository,
    paymentRepository,
    fleetRepository,
    providerBankRepository,
    supportRepository,
    cashfreePaymentProvider,
    undefined,
    googleMapsProvider,
    new PostgresProviderFinanceRepository(pool),
    new PostgresProviderOperationsRepository(pool),
  );

  // ==========================================================
  // HTTP server
  // ==========================================================

  localStorageProvider?.attach(app);
  let active = false;
  const ownershipWait = new AbortController();
  const server = createServer((req, res) => {
    if (!active) return respondWhileStandby(req, res);
    app(req, res);
  });

  // Cloud Run can probe liveness while the serving revision retains ownership.
  // No application request or socket handler is enabled during this overlap.
  const stopStandby = () => {
    ownershipWait.abort();
    server.close();
  };
  process.once('SIGINT', stopStandby);
  process.once('SIGTERM', stopStandby);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.PORT, env.SERVER_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  // ==========================================================
  // Ride services
  // ==========================================================

  const rideService = new RideService(
    rideRepository,
    driverRepository,
    undefined,
    fareEstimateService,
    undefined,
    undefined,
    googleMapsProvider,
  );

  const driverService = new DriverService(driverRepository, undefined, rideRepository);

  const routeRecalculationService = new RouteRecalculationService(googleMapsProvider);

  const matchingService = new MatchingService(driverRepository, googleMapsProvider);

  // ==========================================================
  // Socket.IO
  // ==========================================================

  let onInstanceLost = () => process.exit(1);

  if (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') {
    releaseInstance = await waitForBackendInstance(
      () => acquireBackendInstance(() => onInstanceLost()),
      ownershipWait.signal,
      env.BACKEND_STANDBY,
    );
  }

  await loadDeletedSubjects(pool);
  const io = createSocketServer(server, {
    ...(env.REDIS_URL
      ? {
          notifyRideOffer: async (
            userId: string,
            ride: import('./modules/rides/types/ride.js').Ride,
            expiresAt: Date,
          ) => {
            const { NotificationService } =
              await import('./modules/notifications/services/notification.service.js');
            await new NotificationService().send({
              userId,
              type: 'ride.created',
              title: 'New ride offer',
              body: 'Open INFURNUS to review the current offer.',
              resourceId: `${ride.id}:${expiresAt.getTime()}`,
              eventVersion: 1,
              data: {
                rideId: ride.id,
                expiresAt: expiresAt.toISOString(),
                dispatchNotificationRequestedAt: new Date().toISOString(),
              },
            });
          },
          notifyRideUpdate: async (
            ride: import('./modules/rides/types/ride.js').Ride,
            type: import('./modules/notifications/types/notification.types.js').NotificationType,
          ) => {
            const { NotificationService } =
              await import('./modules/notifications/services/notification.service.js');
            const service = new NotificationService();
            const nowIso = new Date().toISOString();

            console.log(
              JSON.stringify({
                event: 'pin_delivery_trace',
                rideId: ride.id,
                type,
                customerId: ride.customerId,
                assignedDriverId: ride.assignedDriverId,
                timestamp: nowIso,
              }),
            );

            // 1. Notify Assigned Driver
            if (ride.assignedDriverId) {
              const driver = await driverRepository.findProfileById(ride.assignedDriverId);
              if (driver) {
                await service.send({
                  userId: driver.userId,
                  type,
                  title: 'Trip status updated',
                  body: 'Open INFURNUS to view the current trip status.',
                  resourceId: ride.id,
                  eventVersion: new Date(ride.updatedAt).getTime(),
                  data: { rideId: ride.id, eventOccurredAt: nowIso },
                }).catch((err) =>
                  console.warn(
                    JSON.stringify({
                      event: 'driver_push_notify_failed',
                      rideId: ride.id,
                      error: err instanceof Error ? err.message : String(err),
                    }),
                  ),
                );
              }
            }

            // 2. Notify Customer (Passenger) for ride lifecycle & PIN prompt
            if (ride.customerId) {
              const isPinReady = type === 'ride.accepted' || type === 'ride.driver_arrived';
              const title =
                type === 'ride.accepted'
                  ? 'Driver Assigned'
                  : type === 'ride.driver_arrived'
                    ? 'Driver Arrived'
                    : 'Trip Status Updated';
              const body = isPinReady
                ? 'Your driver is heading to pickup. Open INFURNUS to view your verification PIN.'
                : 'Open INFURNUS to view trip updates.';

              await service.send({
                userId: ride.customerId,
                type,
                title,
                body,
                resourceId: ride.id,
                eventVersion: new Date(ride.updatedAt).getTime(),
                data: {
                  rideId: ride.id,
                  eventOccurredAt: nowIso,
                  pinDeliveryRequestedAt: nowIso,
                },
              }).catch((err) =>
                console.warn(
                  JSON.stringify({
                    event: 'customer_push_notify_failed',
                    rideId: ride.id,
                    error: err instanceof Error ? err.message : String(err),
                  }),
                ),
              );
            }
          },
        }
      : {}),
    authorizeAccount: (userId, role) =>
      new PostgresProviderOperationsRepository(pool).authorize(userId, role),
    driverService,
    rideRepository,
    rideService,
    routeRecalculationService,
    matchingService,
  });

  attachProviderTracking(io, new PostgresProviderOperationsRepository(pool));

  onInstanceLost = () => {
    console.error(
      JSON.stringify({
        event: 'backend_instance_session_lost',
      }),
    );

    io.disconnectSockets(true);
    io.close();
    process.exit(1);
  };

  // ==========================================================
  // Start server
  // ==========================================================

  active = true;
  process.off('SIGINT', stopStandby);
  process.off('SIGTERM', stopStandby);
  console.log(`INFURNUS API active on port ${env.PORT} (${env.SERVER_HOST})`);

  // ==========================================================
  // Graceful shutdown
  // ==========================================================

  const shutdown = async (signal: string) => {
    console.log(`${signal} received. Shutting down gracefully...`);

    io.disconnectSockets(true);

    io.close(async () => {
      await releaseInstance?.();

      if (env.REDIS_URL) {
        const { disconnectRedis } = await import('./infrastructure/redis/index.js');

        await disconnectRedis().catch(() => {});
      }

      await notifications?.notificationWorker.close().catch(() => {});
      await notifications?.closeNotificationQueue().catch(() => {});

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
  // Temporary detailed startup diagnostics.
  // This is intentionally verbose so the actual TypeError,
  // message, and stack trace are visible during local debugging.

  console.error('========== BACKEND STARTUP ERROR ==========');
  console.error(error);
  console.error('===========================================');

  console.error(
    JSON.stringify({
      event: 'backend_startup_failed',
      code: error instanceof AppError ? error.code : 'BACKEND_STARTUP_UNAVAILABLE',
      reason: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );

  await releaseInstance?.();

  await pool.end();

  process.exit(1);
});
