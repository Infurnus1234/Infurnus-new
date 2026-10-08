import { MatchingService } from './matching.service.js';
import { rideEvents } from '../events/ride.events.js';
import { validateCoordinates } from '../../maps/geometry.js';
import { env } from '../../../config/env.js';
import { AppError } from '../../../common/errors/app-error.js';
import type {
  DriverAvailabilityInput,
  DriverLocationInput,
  UpsertDriverProfileInput,
} from '../schemas/driver.schemas.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import type { DriverProfile } from '../types/driver.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import { sanitizeRideForDriver } from '../utils/ride-sanitizer.js';

export class DriverService {
  private readonly locationUpdates = new Map<string, number>();
  constructor(
    private readonly repository: DriverRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly rideRepository?: RideRepository,
  ) {}

  async profileForUser(userId: string): Promise<string> {
    const profileId = await this.repository.findProfileIdByUserId(userId);
    if (!profileId) throw new AppError('DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found', 404);
    return profileId;
  }

  async getProfile(userId: string): Promise<DriverProfile> {
    const profile = await this.repository.findProfileByUserId(userId);
    if (!profile) throw new AppError('DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found', 404);
    return profile;
  }

  async upsertProfile(userId: string, input: UpsertDriverProfileInput): Promise<DriverProfile> {
    return this.repository.upsertProfile(userId, input);
  }

  async getDriverHistory(userId: string, limit = 20, isDriverRole = false) {
    const profileId = await this.profileForUser(userId);
    const rides = this.rideRepository
      ? await this.rideRepository.listForDriver(profileId, limit)
      : [];
    const completedRides = rides.filter((r) => r.status === 'completed');

    if (isDriverRole) {
      return {
        totalTrips: completedRides.length,
        totalEarnings: 0,
        rides: rides.map(sanitizeRideForDriver),
      };
    }

    const totalEarnings = completedRides.reduce(
      (sum, r) => sum + (r.finalFare ?? r.fareEstimate ?? 150),
      0,
    );

    return {
      totalTrips: completedRides.length,
      totalEarnings,
      rides,
    };
  }

  async updateAvailability(userId: string, input: DriverAvailabilityInput): Promise<void> {
    const profile = await this.getProfile(userId);
    const profileId = profile.id;

    if (input.status === 'busy' || input.status === 'stale') {
      throw new AppError(
        'DRIVER_AVAILABILITY_SYSTEM_STATE',
        'Busy and stale availability are managed by ride and location state',
        409,
      );
    }

    if (input.status === 'available') {
      if (profile.verificationStatus !== 'approved') {
        throw new AppError(
          'DRIVER_NOT_ELIGIBLE',
          'Only eligible and approved drivers can go online',
          403,
        );
      }

      if (
        profile.licenseExpiry &&
        new Date(profile.licenseExpiry).getTime() < this.clock().getTime()
      ) {
        throw new AppError(
          'DOCUMENT_EXPIRED',
          'Driving license has expired. Please renew and re-upload before going online',
          403,
        );
      }
    }

    const current = await this.repository.getAvailability(profileId);
    if (!current) throw new AppError('DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found', 404);
    if (current === input.status) return;
    if (current === 'busy' && input.status === 'unavailable') {
      throw new AppError('DRIVER_AVAILABILITY_CONFLICT', 'Busy drivers cannot go unavailable', 409);
    }
    if (!(await this.repository.updateAvailability(profileId, input.status))) {
      throw new AppError('DRIVER_AVAILABILITY_CONFLICT', 'Availability update was rejected', 409);
    }
  }

  async updateLocation(userId: string, input: DriverLocationInput): Promise<void> {
    validateCoordinates(input);
    const pending = this.locationUpdates.get(userId) ?? 0;
    if (pending >= 3 || (pending === 0 && this.locationUpdates.size >= 1000))
      throw new AppError(
        'DRIVER_LOCATION_CAPACITY_EXCEEDED',
        'Location ingestion is busy; retry shortly',
        429,
      );
    this.locationUpdates.set(userId, pending + 1);
    try {
      const profileId = await this.profileForUser(userId);
      const now = this.clock();
      if (
        !Number.isFinite(input.timestamp.getTime()) ||
        input.timestamp.getTime() > now.getTime()
      ) {
        throw new AppError(
          'DRIVER_LOCATION_FUTURE',
          'Location timestamp cannot be in the future',
          400,
        );
      }
      if (now.getTime() - input.timestamp.getTime() > env.DRIVER_LOCATION_STALE_SECONDS * 1000)
        throw new AppError('DRIVER_LOCATION_STALE', 'Location timestamp is too old', 400);
      if (
        !(await this.repository.updateLocation(profileId, {
          latitude: input.latitude,
          longitude: input.longitude,
          recordedAt: input.timestamp,
          speed: input.speed,
          heading: input.heading,
          accuracy: input.accuracy,
        }))
      ) {
        throw new AppError(
          'DRIVER_LOCATION_OUT_OF_ORDER',
          'Location timestamp must be newer than the stored location',
          409,
        );
      }
      rideEvents.emit('driver:location_updated', { profileId, userId, location: input });
    } finally {
      const remaining = (this.locationUpdates.get(userId) ?? 1) - 1;
      if (remaining) this.locationUpdates.set(userId, remaining);
      else this.locationUpdates.delete(userId);
    }
  }

  async markDisconnected(
    userId: string,
    stillDisconnected: () => boolean = () => true,
  ): Promise<void> {
    const profileId = await this.profileForUser(userId);
    if (stillDisconnected()) await this.repository.markStale(profileId);
  }

  async getActiveVehicleForUser(
    userId: string,
  ): Promise<{ sector: string; category: string } | null> {
    return this.repository.findActiveVehicleByUserId
      ? this.repository.findActiveVehicleByUserId(userId)
      : null;
  }

  async verifyAssignmentCode(code: string) {
    const preview = await this.repository.verifyAssignmentCode(code);
    if (!preview) {
      throw new AppError(
        'INVALID_ASSIGNMENT_CODE',
        'Assignment code is invalid or has expired',
        404,
      );
    }
    return preview;
  }

  async claimAssignmentCode(userId: string, code: string) {
    const profileId = await this.profileForUser(userId);
    try {
      return await this.repository.claimAssignmentCode(code, userId, profileId);
    } catch (error) {
      if (error instanceof Error && error.message === 'ASSIGNMENT_CODE_INVALID') {
        throw new AppError(
          'INVALID_ASSIGNMENT_CODE',
          'Assignment code is invalid, expired, or already claimed',
          400,
        );
      }
      throw error;
    }
  }

  async setActiveVehicle(userId: string, vehicleId: string) {
    const profileId = await this.profileForUser(userId);
    const updated = await this.repository.setActiveVehicle(profileId, vehicleId);
    if (!updated) {
      throw new AppError(
        'VEHICLE_NOT_ASSIGNED',
        'Vehicle is not assigned to this driver or is inactive',
        400,
      );
    }
    return { success: true, message: 'Active vehicle updated' };
  }

  async getAssignedVehicle(userId: string) {
    const profileId = await this.profileForUser(userId);
    const vehicle = await this.repository.getAssignedVehicle(profileId);
    if (!vehicle) {
      throw new AppError('NO_ASSIGNED_VEHICLE', 'No active vehicle assigned', 404);
    }
    return vehicle;
  }

  async nearby(latitude: number, longitude: number, sector?: string, vehicleCategory?: string) {
    return new MatchingService(this.repository).findRankedDrivers(
      { latitude, longitude },
      sector,
      vehicleCategory,
    );
  }
}
