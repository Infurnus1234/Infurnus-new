import { serviceArea, type ServiceAreaGate } from '../../maps/service-area.js';
import { premiumCityAreas, type PremiumCityAreas } from '../../maps/premium-city-areas.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import type { Coordinates, MapProvider } from '../providers/map.provider.js';
import type { DriverCandidate } from '../types/driver.js';
import { env } from '../../../config/env.js';
import type { Ride } from '../types/ride.js';
import { dispatchPolicy } from './dispatch-policy.js';

export class MatchingService {
  constructor(
    private readonly drivers: DriverRepository,
    private readonly maps?: MapProvider,
    private readonly area: ServiceAreaGate = serviceArea,
    private readonly premiumAreas: Pick<PremiumCityAreas, 'resolve'> = premiumCityAreas,
  ) {}

  async findBestDriver(
    pickup: Coordinates,
    sector?: string,
    vehicleCategory?: string,
  ): Promise<DriverCandidate | null> {
    return (await this.findRankedDrivers(pickup, sector, vehicleCategory))[0] ?? null;
  }

  async findRankedDrivers(
    pickup: Coordinates,
    sector?: string,
    vehicleCategory?: string,
  ): Promise<DriverCandidate[]> {
    await this.area.assertSupported([pickup]);
    const staleBefore = new Date(Date.now() - env.DRIVER_LOCATION_STALE_SECONDS * 1000);
    let candidates =
      sector !== undefined || vehicleCategory !== undefined
        ? await this.drivers.findNearbyEligible(
            pickup.latitude,
            pickup.longitude,
            env.MAP_DRIVER_RADII_METERS[0]!,
            env.MAX_DRIVER_MATCH_CANDIDATES,
            staleBefore,
            sector,
            vehicleCategory,
          )
        : await this.drivers.findNearbyEligible(
            pickup.latitude,
            pickup.longitude,
            env.MAP_DRIVER_RADII_METERS[0]!,
            env.MAX_DRIVER_MATCH_CANDIDATES,
            staleBefore,
          );

    for (const radius of env.MAP_DRIVER_RADII_METERS.slice(1)) {
      if (candidates.length) break;
      candidates = await this.drivers.findNearbyEligible(
        pickup.latitude,
        pickup.longitude,
        radius,
        env.MAX_DRIVER_MATCH_CANDIDATES,
        staleBefore,
        sector,
        vehicleCategory,
      );
    }

    return this.rankCandidates(candidates, pickup, false);
  }

  async findDispatchDrivers(ride: Ride, radiusMeters: number | null): Promise<DriverCandidate[]> {
    await this.area.assertSupported([ride.pickup]);
    const policy = dispatchPolicy(ride.sector ?? 'passenger', ride.vehicleCategory ?? '');
    const city = policy.cityWide ? await this.premiumAreas.resolve(ride.pickup) : undefined;
    const candidates = await this.drivers.findNearbyEligible(
      ride.pickup.latitude,
      ride.pickup.longitude,
      radiusMeters ?? 20000,
      env.MAX_DRIVER_MATCH_CANDIDATES,
      new Date(Date.now() - env.DRIVER_LOCATION_STALE_SECONDS * 1000),
      ride.sector ?? 'passenger',
      ride.vehicleCategory ?? undefined,
      { rideId: ride.id, radiusMeters, ...(city ? { boundaryGeoJson: city.boundaryGeoJson } : {}) },
    );
    return this.rankCandidates(
      [
        ...new Map(
          candidates.map((candidate) => [
            candidate.driverProfileId,
            {
              ...candidate,
              ...(city
                ? { dispatchBoundaryGeoJson: city.boundaryGeoJson, dispatchCityId: city.cityId }
                : {}),
            },
          ]),
        ).values(),
      ],
      ride.pickup,
      policy.rankByDistance,
    );
  }

  private async rankCandidates(
    candidates: DriverCandidate[],
    pickup: Coordinates,
    byDistance: boolean,
  ): Promise<DriverCandidate[]> {
    if (candidates.length === 0 || !this.maps) {
      return [...candidates].sort(
        (left, right) =>
          left.distanceMeters - right.distanceMeters ||
          left.driverProfileId.localeCompare(right.driverProfileId),
      );
    }

    const routes = await this.maps
      .calculateMatrix(
        candidates.map((candidate) => ({
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        })),
        pickup,
      )
      .catch(() => []);
    if (
      byDistance &&
      candidates.some(
        (candidate) =>
          !routes.some(
            (result) =>
              result.origin.latitude === candidate.latitude &&
              result.origin.longitude === candidate.longitude &&
              result.route &&
              Number.isFinite(result.route.distanceMeters) &&
              result.route.distanceMeters >= 0,
          ),
      )
    ) {
      // A partial matrix cannot be compared fairly with geographic distances.
      return [...candidates].sort(
        (a, b) =>
          a.distanceMeters - b.distanceMeters || a.driverProfileId.localeCompare(b.driverProfileId),
      );
    }

    return candidates
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
          (byDistance
            ? (left.route?.distanceMeters ?? left.candidate.distanceMeters) -
              (right.route?.distanceMeters ?? right.candidate.distanceMeters)
            : (left.route?.durationSeconds ?? Number.MAX_SAFE_INTEGER) -
              (right.route?.durationSeconds ?? Number.MAX_SAFE_INTEGER)) ||
          left.candidate.distanceMeters - right.candidate.distanceMeters ||
          left.candidate.driverProfileId.localeCompare(right.candidate.driverProfileId),
      )
      .map(({ candidate }) => candidate);
  }
}
