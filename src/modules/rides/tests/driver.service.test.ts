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
    await new DriverService(repo, () => now).updateAvailability(userId, { status: 'available' });
    expect(repo.updateAvailability).toHaveBeenCalledWith(profileId, 'available');
  });

  it('rejects driver-controlled system states', async () => {
    const service = new DriverService(repository(), () => now);
    await expect(service.updateAvailability(userId, { status: 'busy' })).rejects.toMatchObject({
      code: 'DRIVER_AVAILABILITY_SYSTEM_STATE',
    });
    await expect(service.updateAvailability(userId, { status: 'stale' })).rejects.toMatchObject({
      code: 'DRIVER_AVAILABILITY_SYSTEM_STATE',
    });
  });

  it('rejects a busy driver going unavailable', async () => {
    const service = new DriverService(
      repository({ getAvailability: vi.fn().mockResolvedValue('busy') }),
    );
    await expect(
      service.updateAvailability(userId, { status: 'unavailable' }),
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

  it('rejects a future location timestamp', async () => {
    const service = new DriverService(repository(), () => now);
    await expect(
      service.updateLocation(userId, {
        latitude: 12,
        longitude: 77,
        timestamp: new Date(now.getTime() + 1),
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_LOCATION_FUTURE' });
  });

  it('rejects an out-of-order location reported by persistence', async () => {
    const service = new DriverService(
      repository({ updateLocation: vi.fn().mockResolvedValue(false) }),
      () => now,
    );
    await expect(
      service.updateLocation(userId, {
        latitude: 12,
        longitude: 77,
        timestamp: now,
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_LOCATION_OUT_OF_ORDER' });
  });

  it('marks the owned driver stale on disconnect', async () => {
    const repo = repository();
    await new DriverService(repo).markDisconnected(userId);
    expect(repo.markStale).toHaveBeenCalledWith(profileId);
  });

  it('passes configured freshness and candidate bounds to nearby search', async () => {
    const repo = repository();
    await new DriverService(repo, () => now).nearby(12.9, 77.5);
    expect(repo.findNearbyEligible).toHaveBeenCalledWith(
      12.9,
      77.5,
      expect.any(Number),
      expect.any(Number),
      new Date(now.getTime() - 30_000),
    );
  });

  it('retrieves and upserts driver profile', async () => {
    const repo = repository();
    const service = new DriverService(repo, () => now);

    const profile = await service.getProfile(userId);
    expect(profile.id).toBe(profileId);
    expect(profile.licenseNumber).toBe('DL-12345');

    const upserted = await service.upsertProfile(userId, {
      licenseNumber: 'DL-99999',
      licenseExpiry: '2032-05-15',
    });
    expect(upserted.licenseNumber).toBe('DL-99999');
    expect(repo.upsertProfile).toHaveBeenCalled();
  });

  it('retrieves driver history and aggregates earnings', async () => {
    const repo = repository();
    const mockRideRepo = {
      listForDriver: vi.fn().mockResolvedValue([
        { id: 'ride-1', status: 'completed' },
        { id: 'ride-2', status: 'completed' },
        { id: 'ride-3', status: 'cancelled' },
      ]),
    } as any;

    const service = new DriverService(repo, () => now, mockRideRepo);
    const history = await service.getDriverHistory(userId);

    expect(history.totalTrips).toBe(2);
    expect(history.totalEarnings).toBe(300);
    expect(history.rides.length).toBe(3);
  });
});
