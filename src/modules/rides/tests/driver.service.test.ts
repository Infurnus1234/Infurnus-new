import { describe, expect, it, vi } from 'vitest';
import { DriverService } from '../services/driver.service.js';
import type { DriverRepository } from '../repositories/driver.repository.js';

const profileId = '750e8400-e29b-41d4-a716-446655440000';
const userId = '850e8400-e29b-41d4-a716-446655440000';
const now = new Date('2026-09-08T10:00:00.000Z');

function repository(overrides: Partial<DriverRepository> = {}): DriverRepository {
  return {
    findProfileIdByUserId: vi.fn().mockResolvedValue(profileId),
    getAvailability: vi.fn().mockResolvedValue('unavailable'),
    updateAvailability: vi.fn().mockResolvedValue(true),
    setBusy: vi.fn().mockResolvedValue(true),
    releaseBusy: vi.fn().mockResolvedValue(true),
    updateLocation: vi.fn().mockResolvedValue(true),
    markStale: vi.fn().mockResolvedValue(true),
    findNearbyEligible: vi.fn().mockResolvedValue([]),
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
});
