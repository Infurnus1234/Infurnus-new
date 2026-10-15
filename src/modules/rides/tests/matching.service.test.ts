import { describe, expect, it, vi } from 'vitest';
import { MatchingService } from '../services/matching.service.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import type { MapProvider } from '../providers/map.provider.js';
import type { Ride } from '../types/ride.js';

describe('policy-aware dispatch matching', () => {
  const ride = {
    id: 'test-ride',
    pickup: { latitude: 12, longitude: 77 },
    sector: 'service',
    vehicleCategory: 'ambulance',
  } as Ride;
  it('orders ambulances by road distance rather than travel time', async () => {
    const repo = driverRepository();
    const maps = {
      calculateMatrix: vi.fn().mockResolvedValue(
        candidates.map((c, i) => ({
          origin: { latitude: c.latitude, longitude: c.longitude },
          route: { distanceMeters: i ? 1000 : 5000, durationSeconds: i ? 500 : 10 },
        })),
      ),
    } as unknown as MapProvider;
    const result = await new MatchingService(repo, maps).findDispatchDrivers(ride, null);
    expect(result.map((c) => c.driverProfileId)).toEqual(['a-driver', 'b-driver']);
    expect(repo.findNearbyEligible).toHaveBeenLastCalledWith(
      12,
      77,
      20000,
      expect.any(Number),
      expect.any(Date),
      'service',
      'ambulance',
      { rideId: 'test-ride', radiusMeters: null },
    );
  });
  it('uses geographic ordering for a partial or failed road matrix', async () => {
    for (const calculateMatrix of [
      vi.fn().mockResolvedValue([
        {
          origin: { latitude: 12.1, longitude: 77.1 },
          route: { distanceMeters: 1, durationSeconds: 1 },
        },
      ]),
      vi.fn().mockRejectedValue(new Error('unavailable')),
      ...[Number.NaN, -1, Number.POSITIVE_INFINITY].map((distanceMeters) =>
        vi.fn().mockResolvedValue(
          candidates.map((c) => ({
            origin: { latitude: c.latitude, longitude: c.longitude },
            route: { distanceMeters, durationSeconds: 1 },
          })),
        ),
      ),
    ]) {
      const result = await new MatchingService(driverRepository(), {
        calculateMatrix,
      } as unknown as MapProvider).findDispatchDrivers(ride, null);
      expect(result.map((c) => c.driverProfileId)).toEqual(['a-driver', 'b-driver']);
    }
  });
  it('resolves premium coverage before querying and attaches the selected city', async () => {
    const repo = driverRepository(),
      resolve = vi
        .fn()
        .mockResolvedValue({ cityId: 'TEST_CITY', boundaryGeoJson: 'test-geometry' });
    const result = await new MatchingService(repo, undefined, undefined, {
      resolve,
    }).findDispatchDrivers({ ...ride, sector: 'premium', vehicleCategory: 'sedan' }, null);
    expect(resolve).toHaveBeenCalledWith(ride.pickup);
    expect(result[0]).toMatchObject({
      dispatchCityId: 'TEST_CITY',
      dispatchBoundaryGeoJson: 'test-geometry',
    });
    expect(repo.findNearbyEligible).toHaveBeenLastCalledWith(
      12,
      77,
      20000,
      expect.any(Number),
      expect.any(Date),
      'premium',
      'sedan',
      { rideId: 'test-ride', radiusMeters: null, boundaryGeoJson: 'test-geometry' },
    );
  });
  it('does not query drivers when premium city coverage is missing', async () => {
    const repo = driverRepository(),
      resolve = vi.fn().mockRejectedValue(new Error('city missing'));
    await expect(
      new MatchingService(repo, undefined, undefined, { resolve }).findDispatchDrivers(
        { ...ride, sector: 'premium' },
        null,
      ),
    ).rejects.toThrow('city missing');
    expect(repo.findNearbyEligible).not.toHaveBeenCalled();
  });
});

const candidates = [
  {
    driverProfileId: 'b-driver',
    userId: 'b-user',
    vehicleId: 'b-vehicle',
    distanceMeters: 100,
    latitude: 12.1,
    longitude: 77.1,
    availabilityStatus: 'available' as const,
    verificationStatus: 'approved',
    activeRideCount: 0,
    locationRecordedAt: new Date(),
  },
  {
    driverProfileId: 'a-driver',
    userId: 'a-user',
    vehicleId: 'a-vehicle',
    distanceMeters: 100,
    latitude: 12.2,
    longitude: 77.2,
    availabilityStatus: 'available' as const,
    verificationStatus: 'approved',
    activeRideCount: 0,
    locationRecordedAt: new Date(),
  },
];

function driverRepository() {
  return {
    findNearbyEligible: vi.fn().mockResolvedValue(candidates),
  } as unknown as DriverRepository;
}

describe('MatchingService', () => {
  it('uses deterministic distance/profile ordering without a map provider', async () => {
    const repo = driverRepository();

    await expect(
      new MatchingService(repo).findBestDriver({
        latitude: 12,
        longitude: 77,
      }),
    ).resolves.toEqual(candidates[1]);

    expect(repo.findNearbyEligible).toHaveBeenCalledTimes(1);
  });

  it('uses route duration after spatial reduction', async () => {
    const repo = driverRepository();

    const maps: MapProvider = {
      calculateRoute: vi.fn(),
      calculateMatrix: vi.fn().mockResolvedValue([
        {
          origin: { latitude: 12.1, longitude: 77.1 },
          route: {
            distanceMeters: 200,
            durationSeconds: 100,
          },
        },
        {
          origin: { latitude: 12.2, longitude: 77.2 },
          route: {
            distanceMeters: 100,
            durationSeconds: 50,
          },
        },
      ]),
      geocode: vi.fn(),
      places: vi.fn(),
    };

    await expect(
      new MatchingService(repo, maps).findBestDriver({
        latitude: 12,
        longitude: 77,
      }),
    ).resolves.toEqual(candidates[1]);

    expect(maps.calculateMatrix).toHaveBeenCalledWith(
      [
        { latitude: 12.1, longitude: 77.1 },
        { latitude: 12.2, longitude: 77.2 },
      ],
      { latitude: 12, longitude: 77 },
    );
  });

  it('keeps Google matrix routes aligned with their candidate origins', async () => {
    const repo = driverRepository();

    const maps: MapProvider = {
      calculateRoute: vi.fn(),
      calculateMatrix: vi.fn().mockResolvedValue([
        {
          origin: { latitude: 12.1, longitude: 77.1 },
          route: null,
        },
        {
          origin: { latitude: 12.2, longitude: 77.2 },
          route: {
            distanceMeters: 100,
            durationSeconds: 50,
          },
        },
      ]),
      geocode: vi.fn(),
      places: vi.fn(),
    };

    await expect(
      new MatchingService(repo, maps).findBestDriver({
        latitude: 12,
        longitude: 77,
      }),
    ).resolves.toEqual(candidates[1]);
  });

  it('falls back to deterministic spatial ranking when routing fails', async () => {
    const maps: MapProvider = {
      calculateRoute: vi.fn(),
      calculateMatrix: vi.fn().mockResolvedValue([]),
      geocode: vi.fn(),
      places: vi.fn(),
    };

    await expect(
      new MatchingService(driverRepository(), maps).findBestDriver({
        latitude: 12,
        longitude: 77,
      }),
    ).resolves.toEqual(candidates[1]);
  });

  it('returns no match for an empty eligible candidate set', async () => {
    const repo = driverRepository();

    vi.mocked(repo.findNearbyEligible).mockResolvedValue([]);

    await expect(
      new MatchingService(repo).findBestDriver({
        latitude: 12,
        longitude: 77,
      }),
    ).resolves.toBeNull();
  });
});
