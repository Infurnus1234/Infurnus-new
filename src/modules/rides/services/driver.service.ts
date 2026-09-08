import { env } from '../../../config/env.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { DriverAvailabilityInput, DriverLocationInput } from '../schemas/driver.schemas.js';
import type { DriverRepository } from '../repositories/driver.repository.js';

export class DriverService {
  constructor(
    private readonly repository: DriverRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async profileForUser(userId: string): Promise<string> {
    const profileId = await this.repository.findProfileIdByUserId(userId);
    if (!profileId) throw new AppError('DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found', 404);
    return profileId;
  }

  async updateAvailability(userId: string, input: DriverAvailabilityInput): Promise<void> {
    const profileId = await this.profileForUser(userId);
    if (input.status === 'busy' || input.status === 'stale') {
      throw new AppError(
        'DRIVER_AVAILABILITY_SYSTEM_STATE',
        'Busy and stale availability are managed by ride and location state',
        409,
      );
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
    const profileId = await this.profileForUser(userId);
    const now = this.clock();
    if (input.timestamp.getTime() > now.getTime()) {
      throw new AppError(
        'DRIVER_LOCATION_FUTURE',
        'Location timestamp cannot be in the future',
        400,
      );
    }
    if (
      !(await this.repository.updateLocation(profileId, {
        latitude: input.latitude,
        longitude: input.longitude,
        recordedAt: input.timestamp,
      }))
    ) {
      throw new AppError(
        'DRIVER_LOCATION_OUT_OF_ORDER',
        'Location timestamp must be newer than the stored location',
        409,
      );
    }
  }

  async markDisconnected(userId: string): Promise<void> {
    const profileId = await this.profileForUser(userId);
    await this.repository.markStale(profileId);
  }

  async nearby(latitude: number, longitude: number) {
    const staleBefore = new Date(this.clock().getTime() - env.DRIVER_LOCATION_STALE_SECONDS * 1000);
    return this.repository.findNearbyEligible(
      latitude,
      longitude,
      env.DRIVER_SEARCH_RADIUS_METERS,
      env.MAX_DRIVER_MATCH_CANDIDATES,
      staleBefore,
    );
  }
}
