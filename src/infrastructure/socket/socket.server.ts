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
import type { MatchingService } from '../../modules/rides/services/matching.service.js';
import { RideDispatchService } from '../../modules/rides/services/ride-dispatch.service.js';

export interface RideSocketDependencies {
  driverService: DriverService;
  rideRepository: RideRepository;
  rideService: RideService;
  routeRecalculationService: RouteRecalculationService;
  matchingService?: MatchingService;
  dispatchResponseTimeoutMs?: number;
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
    const dispatchService = rideDependencies.matchingService
      ? new RideDispatchService(
          rideDependencies.rideRepository,
          rideDependencies.matchingService,
          (candidate, ride, expiresAt) => {
            io.to(driverUserRoom(candidate.userId)).emit('ride:incoming', {
              ride: sanitizeRideForDriver(ride),
              expiresAt: expiresAt.toISOString(),
            });
          },
          rideDependencies.dispatchResponseTimeoutMs,
        )
      : null;

    dispatchService?.startRecovery();

    const onRideCreated = (ride: unknown) => {
      if (!dispatchService) return;
      void dispatchService.dispatch(ride as Ride).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: 'ride_dispatch_failed',
            reason: error instanceof Error ? error.name : 'unknown',
          }),
        );
      });
    };

    const onRideAccepted = (ride: {
      id: string;
      sector?: string | null;
      vehicleCategory?: string | null;
    }) => {
      io.to(rideRoom(ride.id)).emit('ride:driver_assigned', { ride });
      const sector = ride.sector || 'passenger';
      const category = ride.vehicleCategory;
      if (category) {
        io.to(driverSectorCategoryRoom(sector, category)).emit('ride:taken', { rideId: ride.id });
      }
      io.to(driverSectorRoom(sector)).emit('ride:taken', { rideId: ride.id });
      io.to('drivers:available').emit('ride:taken', { rideId: ride.id });
    };

    const onRideCancelled = (rideId: string) => {
      rideDependencies.routeRecalculationService.clear(rideId);
      io.to(rideRoom(rideId)).emit('ride:cancelled', { rideId });
      io.to('drivers:available').emit('ride:cancelled', { rideId });
    };

    const onRideLifecycle = (ride: Ride) => {
      if (['completed', 'cancelled'].includes(ride.status))
        rideDependencies.routeRecalculationService.clear(ride.id);
      const segment = ['driver_assigned', 'driver_arriving', 'driver_arrived'].includes(ride.status)
        ? 'pickup'
        : ride.status === 'in_progress'
          ? 'destination'
          : null;
      io.to(rideRoom(ride.id)).emit('ride:lifecycle_updated', {
        ride,
        segment,
        navigationTarget:
          segment === 'pickup' ? ride.pickup : segment === 'destination' ? ride.destination : null,
      });
      if (ride.status === 'completed')
        io.to(rideRoom(ride.id)).emit('ride:completed', {
          rideId: ride.id,
          ride,
          finalFare: ride.finalFare ?? ride.fareEstimate,
          actualDistanceMeters: ride.actualDistanceMeters ?? 0,
          actualFuelCost: ride.actualFuelCost ?? null,
          billing: ride.billing ?? null,
        });
    };

    // Retain bounded fresh watermarks after completion so later delayed events cannot regress broadcasts.
    // Slow active-ride queries must not broadcast an older GPS update last.
    type LocationEvent = {
      profileId: string;
      userId: string;
      location: import('../../modules/rides/schemas/driver.schemas.js').DriverLocationInput;
    };
    const latestLocations = new Map<
      string,
      { timestamp: number; pending: number; queued?: LocationEvent }
    >();
    const onDriverLocation = (event: LocationEvent) => {
      const timestamp = event.location.timestamp.getTime();
      let tracked = latestLocations.get(event.profileId);
      if (!tracked) {
        if (latestLocations.size >= 1000) {
          const cutoff = Date.now() - env.DRIVER_LOCATION_STALE_SECONDS * 1000;
          for (const [profile, state] of latestLocations)
            if (state.pending === 0 && state.timestamp < cutoff) latestLocations.delete(profile);
        }
        if (latestLocations.size >= 1000) return;
        tracked = { timestamp, pending: 0 };
        latestLocations.set(event.profileId, tracked);
      }
      if (timestamp < tracked.timestamp) return;
      tracked.timestamp = timestamp;
      if (tracked.pending >= 2) {
        tracked.queued = event;
        return;
      }
      tracked.pending++;
      const latest = tracked;
      void (async () => {
        const ride = await rideDependencies.rideRepository.findActiveForDriver?.(event.profileId);
        if (
          latest.timestamp !== timestamp ||
          !ride ||
          !['driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress'].includes(
            ride.status,
          )
        )
          return;
        const currentRide = await rideDependencies.rideRepository.findById(ride.id);
        if (
          latest.timestamp !== timestamp ||
          Date.now() - timestamp > env.DRIVER_LOCATION_STALE_SECONDS * 1000 ||
          !currentRide ||
          currentRide.assignedDriverId !== event.profileId ||
          currentRide.status !== ride.status
        )
          return;
        io.to(rideRoom(ride.id)).emit('ride:driver_location_updated', {
          rideId: ride.id,
          location: event.location,
        });
        if (ride.status === 'in_progress' && ride.sector === 'premium')
          await rideDependencies.rideRepository.recordBreadcrumbAndAccumulateDistance?.(
            ride.id,
            event.location.latitude,
            event.location.longitude,
            event.location.speed,
            event.location.heading,
          );
        const work = async () => {
          const active = await rideDependencies.rideRepository.findById(ride.id);
          if (
            latest.timestamp !== timestamp ||
            !active ||
            active.assignedDriverId !== event.profileId ||
            ['completed', 'cancelled'].includes(active.status)
          )
            return;
          const segment = active.status === 'in_progress' ? 'destination' : 'pickup';
          const target = segment === 'destination' ? active.destination : active.pickup;
          const previous =
            rideDependencies.routeRecalculationService.transientMetadata(ride.id) ??
            (await rideDependencies.rideRepository.getRouteMetadata(ride.id));
          if (
            latest.timestamp !== timestamp ||
            Date.now() - timestamp > env.DRIVER_LOCATION_STALE_SECONDS * 1000
          )
            return;
          const next = await rideDependencies.routeRecalculationService.process(
            ride.id,
            previous,
            event.location,
            target,
            segment,
            (metadata) =>
              rideDependencies.rideRepository.updateRouteMetadata(
                ride.id,
                metadata,
                previous?.routeVersion ?? 0,
              ),
            timestamp,
          );
          const current = await rideDependencies.rideRepository.findById(ride.id);
          if (
            latest.timestamp !== timestamp ||
            Date.now() - timestamp > env.DRIVER_LOCATION_STALE_SECONDS * 1000 ||
            !current ||
            current.assignedDriverId !== event.profileId ||
            current.status !== active.status
          )
            return;
          if (next && (next.routeVersion ?? 0) !== (previous?.routeVersion ?? 0))
            io.to(rideRoom(ride.id)).emit('ride:route_updated', {
              rideId: ride.id,
              route: next.route,
              segment,
              routeVersion: next.routeVersion,
            });
          if (next?.segment === segment && next.etaSeconds !== undefined)
            io.to(rideRoom(ride.id)).emit('ride:eta_updated', {
              rideId: ride.id,
              etaSeconds: next.etaSeconds,
              source: 'route_progress_estimate',
              routeState: next.routeState,
              segment,
            });
        };
        if (rideDependencies.rideRepository.withRouteLock)
          await rideDependencies.rideRepository.withRouteLock(ride.id, work);
        else await work();
      })()
        .catch(() => console.warn(JSON.stringify({ event: 'driver_map_processing_failed' })))
        .finally(() => {
          latest.pending--;
          const queued = latest.queued;
          delete latest.queued;
          // Fresh completed watermarks remain; inactive expired entries are pruned at capacity.
          if (queued) onDriverLocation(queued);
        });
    };
    type UserLocationEvent = {
      rideId: string;
      userId: string;
      location: import('../../modules/rides/types/ride-map.js').LiveRideLocation;
    };
    const userLocations = new Map<string, { latest: UserLocationEvent; pending: boolean }>();
    const onUserLocation = (event: UserLocationEvent) => {
      let state = userLocations.get(event.rideId);
      if (!state) {
        if (userLocations.size >= 1000) return;
        state = { latest: event, pending: false };
        userLocations.set(event.rideId, state);
      }
      if (Date.parse(event.location.timestamp) < Date.parse(state.latest.location.timestamp))
        return;
      state.latest = event;
      if (state.pending) return;
      state.pending = true;
      const tracked = state;
      void (async () => {
        const current = await rideDependencies.rideRepository.getRideMapSnapshot?.(
          event.rideId,
          event.userId,
          'user',
        );
        if (
          !current ||
          !current.ride.assignedDriverId ||
          !['driver_assigned', 'driver_arriving', 'driver_arrived', 'in_progress'].includes(
            current.ride.status,
          ) ||
          tracked.latest !== event ||
          Date.now() - Date.parse(event.location.timestamp) >
            env.DRIVER_LOCATION_STALE_SECONDS * 1000 ||
          current.userLocation?.timestamp !== event.location.timestamp
        )
          return;
        io.to(rideRoom(event.rideId)).emit('ride:user_location_updated', {
          rideId: event.rideId,
          location: event.location,
        });
      })()
        .catch(() => console.warn(JSON.stringify({ event: 'user_map_processing_failed' })))
        .finally(() => {
          tracked.pending = false;
          if (tracked.latest !== event) onUserLocation(tracked.latest);
          else userLocations.delete(event.rideId);
        });
    };
    rideEvents.on('ride:user_location_updated', onUserLocation);
    rideEvents.on('driver:location_updated', onDriverLocation);
    rideEvents.on('ride:created', onRideCreated);
    rideEvents.on('ride:accepted', onRideAccepted);
    rideEvents.on('ride:lifecycle_updated', onRideLifecycle);
    rideEvents.on('ride:cancelled', onRideCancelled);

    httpServer.once('close', () => {
      rideEvents.off('ride:user_location_updated', onUserLocation);
      dispatchService?.dispose();
      rideEvents.off('driver:location_updated', onDriverLocation);
      rideEvents.off('ride:created', onRideCreated);
      rideEvents.off('ride:accepted', onRideAccepted);
      rideEvents.off('ride:lifecycle_updated', onRideLifecycle);
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

      socket.on('ride:user_location', async (payload: unknown, ack?: SocketAck) => {
        try {
          if (
            socket.data.auth?.role !== 'customer' ||
            !userId ||
            typeof payload !== 'object' ||
            payload === null
          )
            throw new Error('Denied');
          if ((socket.data.userLocationNextAt ?? 0) > Date.now()) throw new Error('Rate limited');
          socket.data.userLocationNextAt = Date.now() + 1000;
          const { rideId, ...location } = payload as Record<string, unknown>;
          if (typeof rideId !== 'string') throw new Error('Ride required');
          const data = await rideDependencies.rideService.updateUserLocation(
            userId,
            rideId,
            location,
          );
          ack?.({ success: true, data });
        } catch {
          ack?.({
            success: false,
            error: { code: 'RIDE_LOCATION_DENIED', message: 'Ride location update denied' },
          });
        }
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

          const active = await rideDependencies.rideRepository.findById(rideId);
          if (!active || ['completed', 'cancelled'].includes(active.status))
            throw new Error('Inactive ride');
          const location = driverLocationSchema.parse(locationPayload);

          await rideDependencies.driverService.updateLocation(userId!, location);

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

          // Service emits ride:accepted for both HTTP and Socket.IO acceptance.

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

          onRideLifecycle(ride);

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
          const userId = socket.data.auth.userId;
          void io
            .in(driverUserRoom(userId))
            .allSockets()
            .then((sockets) => {
              if (sockets.size === 0)
                return rideDependencies.driverService.markDisconnected?.(
                  userId,
                  () => !io.sockets.adapter.rooms.get(driverUserRoom(userId))?.size,
                );
            })
            .catch(() => console.warn('Driver disconnect state update unavailable'));
        }
      });
    });
  }

  return io;
}
