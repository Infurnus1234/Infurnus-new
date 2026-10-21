import { describe, it, expect, vi } from 'vitest';
import { DriverService } from '../services/driver.service.js';
import { storageService } from '../../../infrastructure/storage/index.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import { sanitizeRideForDriver } from '../utils/ride-sanitizer.js';
import type { Ride } from '../types/ride.js';
vi.mock('../../../infrastructure/storage/index.js', () => ({
  storageService: { getAccessUrl: vi.fn() },
}));
describe('assigned vehicle photo and pickup privacy', () => {
  it('returns the actual assigned registration with a scoped storage URL and no storage key', async () => {
    vi.mocked(storageService.getAccessUrl).mockResolvedValue(
      'https://storage.example/actual-front',
    );
    const storage = {
      storageKey: 'uploaded/front',
      resourceType: 'image',
      accessMode: 'authenticated',
      mimeType: 'image/jpeg',
    };
    const repo = {
      findProfileIdByUserId: vi.fn().mockResolvedValue('profile'),
      getAssignedVehicle: vi
        .fn()
        .mockResolvedValue({
          id: 'actual-vehicle',
          plateNumber: 'ACTUAL 4321',
          verificationStatus: 'pending',
          isActive: false,
          photoStorage: storage,
        }),
    };
    const data = await new DriverService(repo as unknown as DriverRepository).getAssignedVehicle(
      'driver',
    );
    expect(repo.getAssignedVehicle).toHaveBeenCalledWith('profile');
    expect(data).toMatchObject({
      id: 'actual-vehicle',
      plateNumber: 'ACTUAL 4321',
      photoUrl: 'https://storage.example/actual-front',
      isActive: false,
      verificationStatus: 'pending',
    });
    expect(data).not.toHaveProperty('photoStorage');
    expect(storageService.getAccessUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: 'uploaded/front',
        accessMode: 'authenticated',
        options: { expiresIn: 300 },
      }),
    );
  });
  it('does not fail the vehicle card if photo signing fails', async () => {
    vi.mocked(storageService.getAccessUrl).mockRejectedValue(new Error('unavailable'));
    const repo = {
      findProfileIdByUserId: vi.fn().mockResolvedValue('profile'),
      getAssignedVehicle: vi
        .fn()
        .mockResolvedValue({
          id: 'vehicle',
          plateNumber: 'ACTUAL',
          photoStorage: { storageKey: 'front' },
        }),
    };
    expect(
      await new DriverService(repo as unknown as DriverRepository).getAssignedVehicle('driver'),
    ).toMatchObject({ photoUrl: null, photoStatus: 'unavailable' });
  });
  it('redacts destination coordinates, address and arbitrary details until consumed PIN and started status', () => {
    const ride = {
      id: 'ride',
      assignedDriverId: 'driver',
      status: 'driver_arrived',
      pinVerified: false,
      pin: '0007',
      destination: { latitude: 12, longitude: 77 },
      destinationAddress: 'Private drop',
      serviceDetails: { destination: 'Private drop' },
      pickup: { latitude: 13, longitude: 78 },
    } as unknown as Ride;
    expect(sanitizeRideForDriver(ride)).toMatchObject({
      destination: null,
      destinationAddress: null,
      serviceDetails: null,
      rideInformation: { drop: null },
    });
    expect(
      sanitizeRideForDriver({ ...ride, status: 'in_progress', pinVerified: true }),
    ).toMatchObject({
      destination: ride.destination,
      destinationAddress: 'Private drop',
      rideInformation: { drop: { latitude: 12, longitude: 77 } },
    });
    expect(sanitizeRideForDriver({ ...ride, pinVerified: true })).toMatchObject({
      destination: null,
    });
  });
});
