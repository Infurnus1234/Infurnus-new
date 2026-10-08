import { describe, expect, it, vi } from 'vitest';
import { DriverService } from '../services/driver.service.js';
import type { DriverRepository } from '../repositories/driver.repository.js';

const profileId = '750e8400-e29b-41d4-a716-446655440000';
const userId = '850e8400-e29b-41d4-a716-446655440000';
const now = new Date('2026-09-08T10:00:00.000Z');

function repository(overrides: Partial<DriverRepository> = {}): DriverRepository {
  return {
    findProfileIdByUserId: vi.fn().mockResolvedValue(profileId),

    findProfileByUserId: vi.fn().mockResolvedValue({
      id: profileId,
      userId,
      licenseNumber: 'DL-12345',
      licenseExpiry: '2030-01-01',
      verificationStatus: 'approved',
      createdAt: now,
      updatedAt: now,
    }),

    findProfileById: vi.fn().mockResolvedValue({
      id: profileId,
      userId,
      licenseNumber: 'DL-12345',
      licenseExpiry: '2030-01-01',
      verificationStatus: 'approved',
      createdAt: now,
      updatedAt: now,
    }),

    upsertProfile: vi.fn().mockImplementation((uid, input) =>
      Promise.resolve({
        id: profileId,
        userId: uid,
        licenseNumber: input.licenseNumber,
        licenseExpiry: input.licenseExpiry,
        verificationStatus: 'pending',
        createdAt: now,
        updatedAt: now,
      }),
    ),

    updateVerificationStatus: vi.fn().mockResolvedValue(true),

    getAvailability: vi.fn().mockResolvedValue('unavailable'),

    updateAvailability: vi.fn().mockResolvedValue(true),

    setBusy: vi.fn().mockResolvedValue(true),

    releaseBusy: vi.fn().mockResolvedValue(true),

    updateLocation: vi.fn().mockResolvedValue(true),

    markStale: vi.fn().mockResolvedValue(true),

    findNearbyEligible: vi.fn().mockResolvedValue([]),

    verifyAssignmentCode: vi.fn().mockResolvedValue(null),

    claimAssignmentCode: vi.fn().mockResolvedValue(null),

    setActiveVehicle: vi.fn().mockResolvedValue(true),

    getAssignedVehicle: vi.fn().mockResolvedValue(null),

    ...overrides,
  };
}

describe('DriverService', () => {
  it('persists an owned driver availability change', async () => {
    const repo = repository();

    await new DriverService(repo, () => now).updateAvailability(userId, {
      status: 'available',
    });

    expect(repo.updateAvailability).toHaveBeenCalledWith(profileId, 'available');
  });

  it('rejects driver-controlled system states', async () => {
    const service = new DriverService(repository(), () => now);

    await expect(
      service.updateAvailability(userId, {
        status: 'busy',
      }),
    ).rejects.toMatchObject({
      code: 'DRIVER_AVAILABILITY_SYSTEM_STATE',
    });

    await expect(
      service.updateAvailability(userId, {
        status: 'stale',
      }),
    ).rejects.toMatchObject({
      code: 'DRIVER_AVAILABILITY_SYSTEM_STATE',
    });
  });

  it('rejects a busy driver going unavailable', async () => {
    const service = new DriverService(
      repository({
        getAvailability: vi.fn().mockResolvedValue('busy'),
      }),
      () => now,
    );

    await expect(
      service.updateAvailability(userId, {
        status: 'unavailable',
      }),
    ).rejects.toMatchObject({
      code: 'DRIVER_AVAILABILITY_CONFLICT',
    });
  });

  it('accepts a current location update', async () => {
    const repo = repository();

    await new DriverService(repo, () => now).updateLocation(userId, {
      latitude: 12.9,
      longitude: 77.5,
      timestamp: now,
    });

    expect(repo.updateLocation).toHaveBeenCalledWith(profileId, {
      latitude: 12.9,
      longitude: 77.5,
      recordedAt: now,
    });
  });

  it('rejects an out-of-order location update', async () => {
    const repo = repository({
      updateLocation: vi.fn().mockResolvedValue(false),
    });

    const service = new DriverService(repo, () => now);

    const olderTime = new Date(now.getTime() - 1000);

    await expect(
      service.updateLocation(userId, {
        latitude: 12.9,
        longitude: 77.5,
        timestamp: olderTime,
      }),
    ).rejects.toMatchObject({
      code: 'DRIVER_LOCATION_OUT_OF_ORDER',
    });

    expect(repo.updateLocation).toHaveBeenCalledWith(profileId, {
      latitude: 12.9,
      longitude: 77.5,
      recordedAt: olderTime,
    });
  });

  it('rejects a future location update', async () => {
    const futureTime = new Date(now.getTime() + 10 * 60 * 1000);

    const service = new DriverService(repository(), () => now);

    await expect(
      service.updateLocation(userId, {
        latitude: 12.9,
        longitude: 77.5,
        timestamp: futureTime,
      }),
    ).rejects.toMatchObject({
      code: 'DRIVER_LOCATION_FUTURE',
    });
  });

  it('returns the driver profile for the authenticated user', async () => {
    const repo = repository();

    const result = await new DriverService(repo, () => now).getProfile(userId);

    expect(result).toMatchObject({
      id: profileId,
      userId,
      verificationStatus: 'approved',
    });

    expect(repo.findProfileByUserId).toHaveBeenCalledWith(userId);
  });

  it('throws when driver profile does not exist', async () => {
    const service = new DriverService(
      repository({
        findProfileByUserId: vi.fn().mockResolvedValue(null),
      }),
      () => now,
    );

    await expect(service.getProfile(userId)).rejects.toMatchObject({
      code: 'DRIVER_PROFILE_NOT_FOUND',
    });
  });
});

describe('driver GPS freshness and legacy discovery', () => {
  it('rejects stale GPS before persistence', async () => {
    const repo = repository();
    await expect(
      new DriverService(repo, () => now).updateLocation(userId, {
        latitude: 12.9,
        longitude: 77.5,
        timestamp: new Date(now.getTime() - 31000),
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_LOCATION_STALE' });
    expect(repo.updateLocation).not.toHaveBeenCalled();
  });
  it('uses canonical 1km then 2km discovery rather than the legacy 5km setting', async () => {
    const repo = repository();
    repo.findNearbyEligible = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await new DriverService(repo, () => now).nearby(12.9, 77.5);
    expect(vi.mocked(repo.findNearbyEligible).mock.calls.map((args) => args[2])).toEqual([
      1000, 2000,
    ]);
  });
});

it('rechecks driver presence after delayed profile lookup before marking disconnected', async () => {
  const repo = repository();
  let resolve!: (id: string) => void;
  repo.findProfileIdByUserId = vi.fn(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  let disconnected = true;
  const work = new DriverService(repo).markDisconnected(userId, () => disconnected);
  disconnected = false;
  resolve(profileId);
  await work;
  expect(repo.markStale).not.toHaveBeenCalled();
});

it('bounds concurrent GPS ingestion before profile queries and releases capacity afterwards', async () => {
  const repo = repository();
  const profiles: Array<(id: string) => void> = [];
  repo.findProfileIdByUserId = vi.fn(
    () => new Promise<string>((resolve) => profiles.push(resolve)),
  );
  const driver = new DriverService(repo, () => now);
  const input = { latitude: 12.9, longitude: 77.5, timestamp: now };
  const accepted = Array.from({ length: 3 }, () => driver.updateLocation(userId, input));
  await expect(driver.updateLocation(userId, input)).rejects.toMatchObject({
    code: 'DRIVER_LOCATION_CAPACITY_EXCEEDED',
    statusCode: 429,
  });
  expect(repo.findProfileIdByUserId).toHaveBeenCalledTimes(3);
  profiles.forEach((resolve) => resolve(profileId));
  await Promise.all(accepted);
  repo.findProfileIdByUserId = vi.fn(async () => profileId);
  await driver.updateLocation(userId, input);
});
