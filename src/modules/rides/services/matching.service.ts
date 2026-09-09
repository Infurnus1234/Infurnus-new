import type { DriverRepository } from '../repositories/driver.repository.js';
import type { Coordinates, MapProvider } from '../providers/map.provider.js';
import type { DriverCandidate } from '../types/driver.js';
import { env } from '../../../config/env.js';

export class MatchingService {
  constructor(
    private readonly drivers: DriverRepository,
    private readonly maps?: MapProvider,
  ) {}

  async findBestDriver(pickup: Coordinates): Promise<DriverCandidate | null> {
    const candidates = await this.drivers.findNearbyEligible(
      pickup.latitude,
      pickup.longitude,
      env.DRIVER_SEARCH_RADIUS_METERS,
      env.MAX_DRIVER_MATCH_CANDIDATES,
      new Date(Date.now() - env.DRIVER_LOCATION_STALE_SECONDS * 1000),
    );

    if (candidates.length === 0) return null;
    if (!this.maps) return candidates[0] ?? null;

    const routes = await this.maps.calculateMatrix(
      candidates.map((candidate) => ({
        latitude: candidate.latitude,
        longitude: candidate.longitude,
      })),
      pickup,
    );

    return (
      candidates
        .map((candidate) => ({
          candidate,
          route: routes.find(
            (result) =>
              result.origin.latitude === candidate.latitude &&
              result.origin.longitude === candidate.longitude,
          )?.route,
        }))
        .sort(
          (left, right) =>
            (left.route?.durationSeconds ?? Number.MAX_SAFE_INTEGER) -
              (right.route?.durationSeconds ?? Number.MAX_SAFE_INTEGER) ||
            left.candidate.distanceMeters - right.candidate.distanceMeters ||
            left.candidate.driverProfileId.localeCompare(right.candidate.driverProfileId),
        )[0]?.candidate ??
      candidates[0] ??
      null
    );
  }
}