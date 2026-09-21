import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

import { env } from '../../config/env.js';
import { authenticateSocket } from './socket.auth.js';
import {
  driverSectorCategoryRoom,
  driverSectorRoom,
  driverUserRoom,
  joinAuthorizedRideRoom,
  leaveRideRoom,
  rideRoom,
} from './socket.rooms.js';
import { driverLocationSchema } from '../../modules/rides/schemas/driver.schemas.js';
import { rideStatusSchema } from '../../modules/rides/schemas/ride.schemas.js';
import { rideEvents } from '../../modules/rides/events/ride.events.js';
import type { DriverService } from '../../modules/rides/services/driver.service.js';
import type { RideRepository } from '../../modules/rides/repositories/ride.repository.js';
import type { RideService } from '../../modules/rides/services/ride.service.js';
import type { RouteRecalculationService } from '../../modules/rides/services/route-recalculation.service.js';
import type { Ride } from '../../modules/rides/types/ride.js';
import { sanitizeRideForDriver } from '../../modules/rides/utils/ride-sanitizer.js';

export interface RideSocketDependencies {
  driverService: DriverService;
  rideRepository: RideRepository;
  rideService: RideService;
  routeRecalculationService: RouteRecalculationService;
}

interface SocketAck {
  (response: { success: true; data?: unknown }): void;
  (response: { success: false; error: { code: string; message: string } }): void;
}

export function createSocketServer(
  httpServer: HttpServer,
  rideDependencies?: RideSocketDependencies,
): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: env.CORS_CREDENTIALS,
    },
  });

  io.use(async (socket, next) => {
    try {
      await authenticateSocket(socket);
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  if (rideDependencies) {
    const onRideCreated = async (ride: unknown) => {
      const r = ride as Ride;
      const sector = r.sector || 'passenger';
      const category = r.vehicleCategory;

      const driverRide = sanitizeRideForDriver(r);

      if (
        r.pickup?.latitude != null &&
        r.pickup?.longitude != null &&
        rideDependencies.driverService?.nearby
      ) {
        try {
          const candidates = await rideDependencies.driverService.nearby(
            r.pickup.latitude,
            r.pickup.longitude,
            sector,
            category ?? undefined,
          );
          if (candidates && candidates.length > 0) {
            for (const candidate of candidates) {
              io.to(driverUserRoom(candidate.userId)).emit('ride:incoming', { ride: driverRide });
            }
            return;
          }
        } catch {
          // If nearby query fails, fall through to sector room broadcast
        }
      }

      if (category) {
        io.to(driverSectorCategoryRoom(sector, category)).emit('ride:incoming', {
          ride: driverRide,
        });
      } else {
        io.to(driverSectorRoom(sector)).emit('ride:incoming', { ride: driverRide });
      }
    };

    const onRideAccepted = (ride: {
      id: string;
      sector?: string | null;
      vehicleCategory?: string | null;
    }) => {
      const sector = ride.sector || 'passenger';
      const category = ride.vehicleCategory;
      if (category) {
        io.to(driverSectorCategoryRoom(sector, category)).emit('ride:taken', { rideId: ride.id });
      }
      io.to(driverSectorRoom(sector)).emit('ride:taken', { rideId: ride.id });
      io.to('drivers:available').emit('ride:taken', { rideId: ride.id });
    };

    const onRideCancelled = (rideId: string) => {
      io.to('drivers:available').emit('ride:cancelled', { rideId });
    };

    rideEvents.on('ride:created', onRideCreated);
    rideEvents.on('ride:accepted', onRideAccepted);
    rideEvents.on('ride:cancelled', onRideCancelled);

    io.on('close', () => {
      rideEvents.off('ride:created', onRideCreated);
      rideEvents.off('ride:accepted', onRideAccepted);
      rideEvents.off('ride:cancelled', onRideCancelled);
    });

    io.on('connection', async (socket) => {
      const userId = socket.data.auth?.userId;

      if (socket.data.auth?.role === 'driver') {
        let sector =
          (socket.handshake.auth?.sector as string) || (socket.handshake.query?.sector as string);
        let category =
          (socket.handshake.auth?.category as string) ||
          (socket.handshake.query?.category as string);

        if (!sector && rideDependencies.driverService?.getActiveVehicleForUser && userId) {
          try {
            const vehicle = await rideDependencies.driverService.getActiveVehicleForUser(userId);
            if (vehicle) {
              sector = vehicle.sector;
              category = category || vehicle.category;
            }
          } catch {
            // fallback
          }
        }

        sector = sector || 'passenger';
        socket.data.driverSector = sector;
        if (category) {
          socket.data.driverCategory = category;
        }

        await socket.join(driverSectorRoom(sector));
        if (category) {
          await socket.join(driverSectorCategoryRoom(sector, category));
        }
        if (userId) {
          await socket.join(driverUserRoom(userId));
        }
        await socket.join('drivers:available');
        socket.emit('driver:ready', { sector, category });
      }

      socket.on('ride:join', async (rideId: unknown, ack?: SocketAck) => {
        try {
          if (
            typeof rideId !== 'string' ||
            !(await rideDependencies.rideRepository.isParticipant(rideId, userId!))
          ) {
            throw new Error('Ride room authorization failed');
          }

          await joinAuthorizedRideRoom(socket, rideId, (participantId, participantRideId) =>
            rideDependencies.rideRepository.isParticipant(participantRideId, participantId),
          );

          ack?.({
            success: true,
            data: { room: rideRoom(rideId) },
          });
        } catch {
          ack?.({
            success: false,
            error: {
              code: 'RIDE_ROOM_FORBIDDEN',
              message: 'Ride room access denied',
            },
          });
        }
      });

      socket.on('ride:leave', async (rideId: unknown, ack?: SocketAck) => {
        if (typeof rideId === 'string') {
          await leaveRideRoom(socket, rideId);
        }

        ack?.({ success: true });
      });

      socket.on('driver:location', async (payload: unknown, ack?: SocketAck) => {
        try {
          if (
            socket.data.auth?.role !== 'driver' ||
            typeof payload !== 'object' ||
            payload === null
          ) {
            throw new Error('Driver authorization failed');
          }

          const { rideId, ...locationPayload } = payload as Record<string, unknown>;

          if (
            typeof rideId !== 'string' ||
            !(await rideDependencies.rideRepository.isAssignedDriver(rideId, userId!))
          ) {
            throw new Error('Driver ride authorization failed');
          }

          const location = driverLocationSchema.parse(locationPayload);

          await rideDependencies.driverService.updateLocation(userId!, location);

          io.to(rideRoom(rideId)).emit('ride:driver_location_updated', {
            rideId,
            location,
          });

          if (typeof rideDependencies.rideRepository.findById === 'function') {
            const activeRide = await rideDependencies.rideRepository.findById(rideId);
            if (
              activeRide &&
              activeRide.status === 'in_progress' &&
              activeRide.sector === 'premium' &&
              typeof rideDependencies.rideRepository.recordBreadcrumbAndAccumulateDistance ===
                'function'
            ) {
              await rideDependencies.rideRepository.recordBreadcrumbAndAccumulateDistance(
                rideId,
                location.latitude,
                location.longitude,
                location.speed,
                location.heading,
              );
            }
          }

          const routeMetadata = await rideDependencies.rideRepository.getRouteMetadata(rideId);

          const destination = await rideDependencies.rideRepository.getDestination(rideId);

          if (destination) {
            const shouldRecalculate = rideDependencies.routeRecalculationService.shouldRecalculate(
              routeMetadata?.lastCalculatedAt ?? null,
              routeMetadata?.lastOrigin ?? null,
              location,
            );

            if (shouldRecalculate) {
              const route = await rideDependencies.routeRecalculationService.calculate(
                location,
                destination,
              );

              if (route) {
                const metadata = {
                  lastCalculatedAt: Date.now(),
                  lastOrigin: location,
                  route,
                };

                const updated = await rideDependencies.rideRepository.updateRouteMetadata(
                  rideId,
                  metadata,
                );

                if (updated) {
                  io.to(rideRoom(rideId)).emit('ride:route_updated', {
                    rideId,
                    route,
                  });
                }
              }
            }
          }

          ack?.({ success: true });
        } catch {
          ack?.({
            success: false,
            error: {
              code: 'DRIVER_LOCATION_FORBIDDEN',
              message: 'Driver location update denied',
            },
          });
        }
      });

      socket.on('driver:accept', async (rideId: unknown, ack?: SocketAck) => {
        try {
          if (socket.data.auth?.role !== 'driver' || typeof rideId !== 'string') {
            throw new Error('Driver authorization failed');
          }

          const profileId = await rideDependencies.driverService.profileForUser(userId!);

          const ride = await rideDependencies.rideService.acceptRide(profileId, rideId);

          io.to(rideRoom(rideId)).emit('ride:driver_assigned', {
            ride,
          });

          ack?.({ success: true, data: ride });
        } catch {
          ack?.({
            success: false,
            error: {
              code: 'RIDE_ACCEPTANCE_CONFLICT',
              message: 'Ride acceptance denied',
            },
          });
        }
      });

      socket.on('ride:status', async (payload: unknown, ack?: SocketAck) => {
        try {
          if (
            socket.data.auth?.role !== 'driver' ||
            typeof payload !== 'object' ||
            payload === null
          ) {
            throw new Error('Driver authorization failed');
          }

          const { rideId, status, pin } = payload as Record<string, unknown>;

          if (typeof rideId !== 'string') {
            throw new Error('Ride identifier required');
          }

          const profileId = await rideDependencies.driverService.profileForUser(userId!);

          const ride = await rideDependencies.rideService.transitionRide(
            rideId,
            rideStatusSchema.parse(status),
            profileId,
            typeof pin === 'string' ? pin.trim() : undefined,
          );

          io.to(rideRoom(rideId)).emit('ride:lifecycle_updated', {
            ride,
          });

          if (ride.status === 'completed') {
            io.to(rideRoom(rideId)).emit('ride:completed', {
              rideId: ride.id,
              finalFare: ride.finalFare ?? ride.fareEstimate,
              actualDistanceMeters: ride.actualDistanceMeters ?? 0,
              actualFuelCost: ride.actualFuelCost ?? null,
              billing: ride.billing ?? null,
              ride,
            });
          }

          ack?.({ success: true, data: ride });
        } catch (error: unknown) {
          const errorCode =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof (error as { code?: unknown }).code === 'string'
              ? (error as { code: string }).code
              : 'RIDE_TRANSITION_CONFLICT';
          const errorMessage = error instanceof Error ? error.message : 'Ride transition denied';

          ack?.({
            success: false,
            error: {
              code: errorCode,
              message: errorMessage,
            },
          });
        }
      });

      socket.on('disconnect', () => {
        if (socket.data.auth?.role === 'driver') {
          void rideDependencies.driverService.markDisconnected?.(socket.data.auth.userId);
        }
      });
    });
  }

  return io;
}
