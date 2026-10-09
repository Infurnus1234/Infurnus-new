import type { CommonMapService } from '../../maps/map.service.js';
import type { RideMapData, UserRideMapData, DriverRideMapData } from '../types/ride-map.js';
import { activeMapStatuses, freshRideLocation, rideInformation } from '../utils/ride-map-mapper.js';
import {
  geographicDistance,
  validRouteResult,
  routeProgress,
  decodePolyline,
} from '../../maps/geometry.js';
import { userRideLocationSchema } from '../schemas/ride.schemas.js';
import { env } from '../../../config/env.js';
import { serviceArea, type ServiceAreaGate } from '../../maps/service-area.js';
import { withTransaction } from '../../../infrastructure/database/postgres.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { CancelRideInput, CreateRideInput, ListRidesInput } from '../schemas/ride.schemas.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { RideStatus } from '../types/ride.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import type { DriverDocumentStorageService } from '../services/driver-document-storage.service.js';
import { rideEvents } from '../events/ride.events.js';
import type { FareEstimateService } from '../../fares/services/fare-estimate.service.js';
import { FIXED_QUOTE_REQUIRED_MESSAGE } from '../../fares/config/fare.config.js';

export type RideTransactionRunner = typeof withTransaction;

export class RideService {
  private readonly userLocationPending = new Map<string, number>();
  constructor(
    private readonly repository: RideRepository,
    private readonly driverRepository?: DriverRepository,
    private readonly driverDocumentStorageService?: DriverDocumentStorageService,
    private readonly fareEstimateService?: FareEstimateService,
    private readonly transactionRunner: RideTransactionRunner = withTransaction,
    private readonly area: ServiceAreaGate = serviceArea,
    private readonly maps?: CommonMapService,
  ) {}

  async createRide(customerId: string, input: CreateRideInput) {
    await this.area.assertSupported([input.pickup, input.destination]);
    if (!this.fareEstimateService) {
      throw new AppError(
        'FARE_ESTIMATOR_UNAVAILABLE',
        'Ride booking is unavailable because fare estimation is not configured',
        503,
      );
    }

    const fare = await this.fareEstimateService.estimate(input.pickup, input.destination, {
      pricingMode: 'vehicle_range',
      sector: input.sector,
      vehicleCategory: input.vehicleCategory,
      ...(input.sector === 'passenger' && input.waitingMinutes !== undefined
        ? { waitingMinutes: input.waitingMinutes }
        : {}),
      weightKg: input.sector === 'logistics' ? input.goods?.weightKg : undefined,
      hasLoadingAssistance:
        input.sector === 'logistics'
          ? (input.goods?.hasLoadingAssistance ?? input.goods?.loadingAssistance)
          : undefined,
      rentalHours:
        input.sector === 'premium'
          ? (input.rentalDetails?.hours ?? input.rentalDetails?.rentalHours)
          : undefined,
      fuelRatePerKm: input.sector === 'premium' ? input.rentalDetails?.fuelRatePerKm : undefined,
    });
    const bookingFare =
      'estimateType' in fare
        ? fare.estimateType === 'range' && fare.bookable
          ? fare.bookingFare
          : undefined
        : fare;
    if (
      !bookingFare ||
      !Number.isSafeInteger(bookingFare.grossAmount) ||
      bookingFare.grossAmount < 0
    ) {
      throw new AppError('FARE_FIXED_QUOTE_REQUIRED', FIXED_QUOTE_REQUIRED_MESSAGE, 422);
    }
    // rides.fare_estimate is NUMERIC(10, 2): reject overflow before persistence.
    if (bookingFare.grossAmount > 9_999_999_999) {
      throw new AppError(
        'FARE_AMOUNT_UNSUPPORTED',
        'The booking quote exceeds the supported amount.',
        422,
      );
    }
    const ride = await this.repository.create(customerId, {
      ...input,
      fareEstimate: bookingFare.grossAmount / 100,
      bookingDistanceMeters: bookingFare.distanceMeters,
      bookingFareSnapshot: bookingFare,
    });
    const hydratedRide = await this.hydrateDriverPhoto(ride);
    rideEvents.emit('ride:created', hydratedRide);
    return hydratedRide;
  }

  async getUserMap(userId: string, id: string, includeRoute = false): Promise<UserRideMapData> {
    return { ...(await this.participantMap(userId, id, 'user', includeRoute)), view: 'user' };
  }
  async getDriverMap(userId: string, id: string, includeRoute = false): Promise<DriverRideMapData> {
    return { ...(await this.participantMap(userId, id, 'driver', includeRoute)), view: 'driver' };
  }
  async getDriverCurrentRide(userId: string) {
    if (!this.driverRepository || !this.repository.findActiveForDriver)
      throw new AppError('RIDE_MAP_UNAVAILABLE', 'Ride map is unavailable', 503);
    const profile = await this.driverRepository.findProfileIdByUserId(userId);
    return profile ? this.repository.findActiveForDriver(profile) : null;
  }
  async updateUserLocation(userId: string, id: string, input: unknown) {
    const pending = this.userLocationPending.get(userId) ?? 0;
    if (pending >= 3 || (!pending && this.userLocationPending.size >= 1000))
      throw new AppError('RIDE_LOCATION_CAPACITY', 'Too many pending location updates', 429);
    this.userLocationPending.set(userId, pending + 1);
    try {
      return await this.persistUserLocation(userId, id, input);
    } finally {
      const remaining = (this.userLocationPending.get(userId) ?? 1) - 1;
      if (remaining) this.userLocationPending.set(userId, remaining);
      else this.userLocationPending.delete(userId);
    }
  }
  private async persistUserLocation(userId: string, id: string, input: unknown) {
    const location = userRideLocationSchema.parse(input),
      now = Date.now();
    const age = now - location.timestamp.getTime();
    if (age < 0 || age > env.DRIVER_LOCATION_STALE_SECONDS * 1000)
      throw new AppError(
        'RIDE_LOCATION_TIMESTAMP_INVALID',
        'Location must be fresh and not in the future',
        400,
      );
    if (!this.repository.getRideMapSnapshot || !this.repository.updateUserLocation)
      throw new AppError('RIDE_MAP_UNAVAILABLE', 'Ride location is unavailable', 503);
    const snapshot = await this.repository.getRideMapSnapshot(id, userId, 'user');
    if (!snapshot) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
    await this.area.assertSupported([location, snapshot.ride.pickup, snapshot.ride.destination]);
    const value = {
      latitude: location.latitude,
      longitude: location.longitude,
      timestamp: location.timestamp.toISOString(),
    };
    if (!(await this.repository.updateUserLocation(id, userId, value)))
      throw new AppError('RIDE_LOCATION_CONFLICT', 'Location is older or ride is inactive', 409);
    rideEvents.emit('ride:user_location_updated', { rideId: id, userId, location: value });
    return value;
  }
  private async participantMap(
    userId: string,
    id: string,
    view: 'user' | 'driver',
    includeRoute: boolean,
  ): Promise<RideMapData> {
    const snapshot = await this.repository.getRideMapSnapshot?.(id, userId, view);
    if (!snapshot) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
    let { ride } = snapshot;
    await this.area.assertSupported([ride.pickup, ride.destination]);
    const active = activeMapStatuses.includes(ride.status) && !!ride.assignedDriverId;
    let driverLocation = active ? freshRideLocation(snapshot.driverLocation) : null;
    let userLocation = active ? freshRideLocation(snapshot.userLocation) : null;
    const segment = active ? (ride.status === 'in_progress' ? 'destination' : 'pickup') : null;
    const metadata = snapshot.metadata;
    let route: RideMapData['route'] = null,
      progress: RideMapData['progress'] = null,
      eta: RideMapData['eta'] = null;
    let routeStatus: RideMapData['routeStatus'] = active
      ? includeRoute
        ? 'unavailable'
        : 'not_requested'
      : 'inactive';
    let routeVersion = 0;
    const target = segment === 'destination' ? ride.destination : ride.pickup;
    if (
      active &&
      this.maps?.navigationStorageAllowed &&
      metadata?.segment === segment &&
      metadata.destination?.latitude === target.latitude &&
      metadata.destination?.longitude === target.longitude &&
      metadata.route &&
      validRouteResult(metadata.route)
    ) {
      route = metadata.route;
      routeStatus = 'available';
      routeVersion = metadata.routeVersion ?? 0;
      if (driverLocation && route.encodedPolyline)
        progress = routeProgress(driverLocation, decodePolyline(route.encodedPolyline));
      eta = {
        seconds: progress
          ? Math.ceil(route.durationSeconds * progress.remainingFraction)
          : route.durationSeconds,
        source: progress ? 'route_progress_estimate' : 'provider_route',
      };
    } else if (
      active &&
      includeRoute &&
      this.maps &&
      (segment === 'destination' || driverLocation)
    ) {
      route = await this.maps
        .calculateRoute(segment === 'destination' ? ride.pickup : driverLocation!, target, {
          source: 'RIDE',
        })
        .catch((error: unknown) => {
          if (error instanceof AppError && error.code === 'MAP_PROVIDER_INVALID') throw error;
          return null;
        });
      if (route && !validRouteResult(route))
        throw new AppError('MAP_PROVIDER_INVALID', 'Invalid ride route', 503);
      if (route) {
        routeStatus = 'available';
        eta = { seconds: route.durationSeconds, source: 'provider_route' };
      }
    }
    // Provider work is asynchronous: re-authorize lifecycle/assignment before exposing locations.
    const current = await this.repository.getRideMapSnapshot?.(id, userId, view);
    if (!current) throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
    if (
      current.ride.status !== ride.status ||
      current.ride.assignedDriverId !== ride.assignedDriverId
    )
      return this.inactiveMap(current.ride);
    ride = current.ride;
    driverLocation = active ? freshRideLocation(current.driverLocation) : null;
    userLocation = active ? freshRideLocation(current.userLocation) : null;
    if ((current.metadata?.routeVersion ?? 0) > (metadata?.routeVersion ?? 0)) {
      route = null;
      progress = null;
      eta = null;
      routeVersion = 0;
      routeStatus = 'unavailable';
    }
    if (route && driverLocation && route.encodedPolyline) {
      progress = routeProgress(driverLocation, decodePolyline(route.encodedPolyline));
      if (progress)
        eta = {
          seconds: Math.ceil(route.durationSeconds * progress.remainingFraction),
          source: 'route_progress_estimate',
        };
    }
    return {
      ...rideInformation(ride),
      rideId: ride.id,
      driverLocation,
      userLocation,
      driverLocationFresh: !!driverLocation,
      pickupDistance:
        segment === 'pickup' && driverLocation
          ? {
              meters: Math.round(geographicDistance(driverLocation, ride.pickup)),
              source: 'geographic',
            }
          : null,
      pickupEta: segment === 'pickup' ? eta : null,
      route,
      routeStatus,
      segment,
      progress,
      eta,
      routeVersion,
      updatedAt: ride.updatedAt.toISOString(),
    };
  }
  private inactiveMap(ride: import('../types/ride.js').Ride): RideMapData {
    return {
      ...rideInformation(ride),
      rideId: ride.id,
      driverLocation: null,
      userLocation: null,
      driverLocationFresh: false,
      pickupDistance: null,
      pickupEta: null,
      route: null,
      routeStatus: 'inactive',
      segment: null,
      progress: null,
      eta: null,
      routeVersion: 0,
      updatedAt: ride.updatedAt.toISOString(),
    };
  }

  async listRides(customerId: string, query: ListRidesInput) {
    const rides = await this.repository.listForCustomer(customerId, query);
    return this.hydrateDriverPhotos(rides);
  }

  async listAvailableRides(driverProfileId: string, limit?: number) {
    const rides = await this.repository.listAvailableForDriver(driverProfileId, limit);
    return this.hydrateDriverPhotos(rides);
  }

  async rejectRide(driverProfileId: string, id: string): Promise<void> {
    const released = await this.repository.finishDispatchAttempt(id, driverProfileId, 'rejected');
    if (!released) {
      throw new AppError(
        'RIDE_DISPATCH_OFFER_EXPIRED',
        'This ride request is no longer assigned to you',
        409,
      );
    }
    rideEvents.emit('ride:dispatch_rejected', { rideId: id, driverProfileId });
  }

  async getRide(customerId: string, id: string) {
    const ride = await this.repository.findByIdForCustomer(id, customerId);

    if (!ride) {
      throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
    }

    return this.hydrateDriverPhoto(ride);
  }

  async cancelRide(customerId: string, id: string, input: CancelRideInput) {
    const ride = await this.transactionRunner(async (client) => {
      const cancelled = await this.repository.cancel(id, customerId, input.reason, client);
      if (cancelled?.assignedDriverId && this.driverRepository)
        await this.driverRepository.releaseBusy(cancelled.assignedDriverId, client);
      return cancelled;
    });

    if (!ride) {
      const existing = await this.repository.findByIdForCustomer(id, customerId);

      if (!existing) {
        throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
      }

      throw new AppError(
        'RIDE_CANCELLATION_CONFLICT',
        'Ride cannot be cancelled in its current state',
        409,
      );
    }

    const hydratedRide = await this.hydrateDriverPhoto(ride);

    rideEvents.emit('ride:cancelled', id);

    return hydratedRide;
  }

  async acceptRide(driverProfileId: string, id: string) {
    if (this.area.configured || this.area.required) {
      const existing = await this.repository.findById(id);
      await this.area.assertSupported(existing ? [existing.pickup, existing.destination] : []);
    }
    try {
      const ride = await this.transactionRunner(async (client) => {
        const accepted = await this.repository.accept(id, driverProfileId, client);
        // A CTE can update the ride but lose offer consumption to a competing timeout.
        // Reject inside the transaction so every partial write rolls back.
        if (!accepted)
          throw new AppError('RIDE_ACCEPTANCE_CONFLICT', 'Ride is no longer available', 409);

        if (
          accepted &&
          this.driverRepository &&
          !(await this.driverRepository.setBusy(driverProfileId, client))
        ) {
          throw new AppError('DRIVER_CONTENTION_CONFLICT', 'Driver is no longer available', 409);
        }

        return accepted;
      });

      if (!ride) {
        throw new AppError('RIDE_ACCEPTANCE_CONFLICT', 'Ride is no longer available', 409);
      }

      const hydratedRide = await this.hydrateDriverPhoto(ride);

      rideEvents.emit('ride:accepted', hydratedRide);

      return hydratedRide;
    } catch (error) {
      if (isPostgresCode(error, '23505')) {
        throw new AppError(
          'DRIVER_CONTENTION_CONFLICT',
          'Driver is already assigned to another ride',
          409,
        );
      }

      throw error;
    }
  }

  async completeRide(id: string, driverProfileId: string) {
    return this.transactionRunner(async (client) => {
      const ride = await this.repository.complete(id, driverProfileId, client);

      if (!ride) {
        throw new AppError(
          'RIDE_COMPLETION_CONFLICT',
          'Ride cannot be completed in its current state',
          409,
        );
      }

      if (!this.driverRepository) {
        throw new AppError(
          'DRIVER_REPOSITORY_UNAVAILABLE',
          'Driver repository is unavailable',
          500,
        );
      }

      const released = await this.driverRepository.releaseBusy(driverProfileId, client);

      if (!released) {
        throw new AppError('DRIVER_RELEASE_CONFLICT', 'Assigned driver could not be released', 409);
      }

      if (ride.sector === 'premium' && !ride.bookingPricingVersion?.startsWith('vehicle-type:')) {
        const bookedHours = Math.max(
          1,
          Number(ride.rentalDetails?.rentalHours ?? ride.rentalDetails?.hours ?? 1),
        );

        const hourlyRate = 1000;
        const hourlyBase = bookedHours * hourlyRate;
        const actualDistanceMeters = ride.actualDistanceMeters ?? 0;

        const actualDistanceKm = Math.round((actualDistanceMeters / 1000) * 100) / 100;

        const actualFuelCost = Number(ride.actualFuelCost ?? 0);

        const subtotal = hourlyBase + actualFuelCost;

        const taxAmount = Math.round(subtotal * 0.05 * 100) / 100;

        const finalFare = Number(ride.finalFare ?? Math.round((subtotal + taxAmount) * 100) / 100);

        ride.billing = {
          currency: 'INR',
          hourlyRate,
          bookedHours,
          hourlyBase,
          fuelRatePerKm:
            actualDistanceKm > 0 ? Math.round((actualFuelCost / actualDistanceKm) * 100) / 100 : 15,
          actualDistanceKm,
          actualDistanceMeters,
          actualFuelCost,
          subtotal,
          taxAmount,
          finalFare,
        };
      } else {
        ride.billing = {
          currency: 'INR',
          finalFare: Number(ride.finalFare ?? ride.fareEstimate ?? 0),
        };
      }

      return this.hydrateDriverPhoto(ride);
    });
  }

  async verifyRidePin(
    rideId: string,
    driverProfileId: string,
    inputPin: string,
  ): Promise<{ verified: boolean }> {
    if (typeof inputPin !== 'string' || !/^\d{4}$/.test(inputPin.trim())) {
      throw new AppError('INVALID_PIN', 'PIN must be exactly 4 digits', 400);
    }

    const normalizedPin = inputPin.trim();
    if (this.repository.verifyPinAttempt) {
      const result = await this.repository.verifyPinAttempt(rideId, driverProfileId, normalizedPin);
      if (result === 'verified') return { verified: true };
      const errors = {
        invalid: ['INVALID_PIN', 'Invalid ride verification PIN', 400],
        locked: ['PIN_ATTEMPTS_EXCEEDED', 'Too many PIN attempts. Retry after 10 minutes.', 429],
        not_found: ['RIDE_NOT_FOUND', 'Ride not found or PIN not generated', 404],
        forbidden: ['FORBIDDEN', 'Not assigned to this ride', 403],
        invalid_state: ['INVALID_RIDE_STATE', 'Cannot verify PIN in this ride state', 409],
      } as const;
      const [code, message, status] = errors[result];
      throw new AppError(code, message, status);
    }

    const isAssigned = await this.repository.isAssignedDriverProfile(rideId, driverProfileId);

    if (!isAssigned) {
      throw new AppError('FORBIDDEN', 'Not assigned to this ride', 403);
    }

    if (typeof this.repository.findById === 'function') {
      const ride = await this.repository.findById(rideId);

      if (!ride) {
        throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
      }

      if (
        ride.status === 'cancelled' ||
        ride.status === 'completed' ||
        ride.status === 'requested' ||
        ride.status === 'searching'
      ) {
        throw new AppError(
          'INVALID_RIDE_STATE',
          `Cannot verify PIN for ride in '${ride.status}' status`,
          409,
        );
      }
    }

    const storedPin = await this.repository.getRidePin(rideId);

    if (!storedPin) {
      throw new AppError('RIDE_NOT_FOUND', 'Ride not found or PIN not generated', 404);
    }

    if (storedPin !== normalizedPin) {
      throw new AppError('INVALID_PIN', 'Invalid ride verification PIN', 400);
    }

    await this.repository.markPinVerified(rideId);

    return { verified: true };
  }

  async transitionRide(id: string, status: RideStatus, assignedDriverId?: string, pin?: string) {
    if (status === 'completed') {
      if (!assignedDriverId) {
        throw new AppError(
          'RIDE_TRANSITION_CONFLICT',
          'Assigned driver is required to complete a ride',
          409,
        );
      }

      return this.completeRide(id, assignedDriverId);
    }

    if (status === 'driver_arrived' && pin !== undefined) {
      if (!assignedDriverId) {
        throw new AppError('FORBIDDEN', 'Assigned driver is required to verify PIN', 403);
      }

      await this.verifyRidePin(id, assignedDriverId, pin);
    }

    if (status === 'in_progress') {
      if (!assignedDriverId) {
        throw new AppError('FORBIDDEN', 'Assigned driver is required to start a ride', 403);
      }

      const isAssigned = await this.repository.isAssignedDriverProfile(id, assignedDriverId);

      if (!isAssigned) {
        throw new AppError('FORBIDDEN', 'Not assigned to this ride', 403);
      }

      if (typeof this.repository.findById === 'function') {
        const currentRide = await this.repository.findById(id);

        if (!currentRide) {
          throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
        }

        if (currentRide.status !== 'driver_arrived' && currentRide.status !== 'in_progress') {
          throw new AppError(
            'RIDE_TRANSITION_CONFLICT',
            `Cannot start ride from '${currentRide.status}' state`,
            409,
          );
        }
      }

      if (pin !== undefined) {
        await this.verifyRidePin(id, assignedDriverId, pin);
      }

      const isVerified = await this.repository.isPinVerified(id);

      if (!isVerified) {
        throw new AppError(
          'PIN_VERIFICATION_REQUIRED',
          'Ride pickup PIN must be verified before starting the trip',
          409,
        );
      }
    }

    try {
      const ride = await this.repository.transition(id, status, assignedDriverId);

      if (!ride) {
        throw new AppError('RIDE_NOT_FOUND', 'Ride not found', 404);
      }

      return this.hydrateDriverPhoto(ride);
    } catch (error) {
      if (isPostgresCode(error, 'P0001')) {
        throw new AppError('RIDE_TRANSITION_CONFLICT', 'Invalid ride lifecycle transition', 409);
      }

      throw error;
    }
  }

  private async hydrateDriverPhoto(
    ride: Awaited<ReturnType<RideRepository['findById']>>,
  ): Promise<NonNullable<typeof ride>> {
    if (
      !ride ||
      !ride.driverDetails ||
      !ride.assignedDriverId ||
      !this.driverDocumentStorageService
    ) {
      return ride as NonNullable<typeof ride>;
    }

    const photoUrl = await this.driverDocumentStorageService.getProfilePhotoAccessUrl(
      ride.assignedDriverId,
    );

    ride.driverDetails.photoUrl = photoUrl;

    return ride as NonNullable<typeof ride>;
  }

  private async hydrateDriverPhotos(
    rides: Awaited<ReturnType<RideRepository['listForCustomer']>>,
  ): Promise<typeof rides> {
    if (!this.driverDocumentStorageService || rides.length === 0) {
      return rides;
    }

    await Promise.all(rides.map((ride) => this.hydrateDriverPhoto(ride)));

    return rides;
  }
}

function isPostgresCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
