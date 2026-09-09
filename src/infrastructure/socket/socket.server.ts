import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

import { env } from '../../config/env.js';
import { authenticateSocket } from './socket.auth.js';
import { joinAuthorizedRideRoom, leaveRideRoom, rideRoom } from './socket.rooms.js';
import { driverLocationSchema } from '../../modules/rides/schemas/driver.schemas.js';
import { rideStatusSchema } from '../../modules/rides/schemas/ride.schemas.js';
import type { DriverService } from '../../modules/rides/services/driver.service.js';
import type { RideRepository } from '../../modules/rides/repositories/ride.repository.js';
import type { RideService } from '../../modules/rides/services/ride.service.js';
import type { RouteRecalculationService } from '../../modules/rides/services/route-recalculation.service.js';

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
    io.on('connection', (socket) => {
      const userId = socket.data.auth?.userId;

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

          const { rideId, status } = payload as Record<string, unknown>;

          if (typeof rideId !== 'string') {
            throw new Error('Ride identifier required');
          }

          const profileId = await rideDependencies.driverService.profileForUser(userId!);

          const ride = await rideDependencies.rideService.transitionRide(
            rideId,
            rideStatusSchema.parse(status),
            profileId,
          );

          io.to(rideRoom(rideId)).emit('ride:lifecycle_updated', {
            ride,
          });

          ack?.({ success: true, data: ride });
        } catch {
          ack?.({
            success: false,
            error: {
              code: 'RIDE_TRANSITION_CONFLICT',
              message: 'Ride transition denied',
            },
          });
        }
      });

      socket.on('disconnect', () => {
        if (socket.data.auth?.role === 'driver') {
          void rideDependencies.driverService.markDisconnected(socket.data.auth.userId);
        }
      });
    });
  }

  return io;
}
