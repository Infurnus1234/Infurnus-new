import { describe, expect, it, vi } from 'vitest';
import { MatchingService } from '../services/matching.service.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import type { MapProvider } from '../providers/map.provider.js';

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
  it('uses the first bounded PostGIS candidate without a map provider', async () => {
    const repo = driverRepository();
    await expect(
      new MatchingService(repo).findBestDriver({ latitude: 12, longitude: 77 }),
    ).resolves.toEqual(candidates[0]);
    expect(repo.findNearbyEligible).toHaveBeenCalledTimes(1);
  });

  it('uses route duration after spatial reduction', async () => {
    const repo = driverRepository();
    const maps: MapProvider = {
      calculateRoute: vi.fn(),
      calculateMatrix: vi.fn().mockResolvedValue([
        { distanceMeters: 200, durationSeconds: 100 },
        { distanceMeters: 100, durationSeconds: 50 },
      ]),
      geocode: vi.fn(),
      places: vi.fn(),
    };
    await expect(
      new MatchingService(repo, maps).findBestDriver({ latitude: 12, longitude: 77 }),
    ).resolves.toEqual(candidates[1]);
    expect(maps.calculateMatrix).toHaveBeenCalledWith(
      [
        { latitude: 12.1, longitude: 77.1 },
        { latitude: 12.2, longitude: 77.2 },
      ],
      { latitude: 12, longitude: 77 },
    );
  });

  it('falls back to deterministic spatial ranking when routing fails', async () => {
    const maps: MapProvider = {
      calculateRoute: vi.fn(),
      calculateMatrix: vi.fn().mockResolvedValue([]),
      geocode: vi.fn(),
      places: vi.fn(),
    };
    await expect(
      new MatchingService(driverRepository(), maps).findBestDriver({ latitude: 12, longitude: 77 }),
    ).resolves.toEqual(candidates[1]);
  });

  it('returns no match for an empty eligible candidate set', async () => {
    const repo = driverRepository();
    vi.mocked(repo.findNearbyEligible).mockResolvedValue([]);
    await expect(
      new MatchingService(repo).findBestDriver({ latitude: 12, longitude: 77 }),
    ).resolves.toBeNull();
  });
});
