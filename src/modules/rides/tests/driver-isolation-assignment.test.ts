import { describe, expect, it, vi } from 'vitest';
import { sanitizeRideForDriver } from '../utils/ride-sanitizer.js';
import { DriverService } from '../services/driver.service.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { Ride } from '../types/ride.js';

describe('Driver Zero-Fare Financial Isolation & Sanitization', () => {
  it('strips all fare and financial billing fields from ride payloads sent to driver', () => {
    const rawRide = {
      id: '990e8400-e29b-41d4-a716-446655440000',
      customerId: '110e8400-e29b-41d4-a716-446655440000',
      pickupAddress: 'MG Road, Bangalore',
      destinationAddress: 'Indiranagar, Bangalore',
      pickupLatitude: 12.9716,
      pickupLongitude: 77.5946,
      destinationLatitude: 12.9784,
      destinationLongitude: 77.6408,
      status: 'driver_assigned',
      fareEstimate: 350.50,
      finalFare: 360.00,
      actualFuelCost: 45.20,
      pinVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Ride;

    const sanitized = sanitizeRideForDriver(rawRide) as Record<string, unknown>;

    expect(sanitized.id).toBe(rawRide.id);
    expect(sanitized.pickupAddress).toBe('MG Road, Bangalore');
    // Financial data must NEVER reach driver
    expect(sanitized.fareEstimate).toBeUndefined();
    expect(sanitized.finalFare).toBeUndefined();
    expect(sanitized.actualFuelCost).toBeUndefined();
    expect(sanitized.billing).toBeUndefined();
  });

  it('hides total earnings and ride fares in driver history when isDriverRole is true', async () => {
    const mockRideRepo: Partial<RideRepository> = {
      listForDriver: vi.fn().mockResolvedValue([
        {
          id: 'ride-1',
          pickupAddress: 'Point A',
          destinationAddress: 'Point B',
          status: 'completed',
          finalFare: 450,
          completedAt: new Date(),
        } as unknown as Ride,
      ]),
    };

    const mockDriverRepo: Partial<DriverRepository> = {
      findProfileIdByUserId: vi.fn().mockResolvedValue('profile-1'),
    };

    const service = new DriverService(
      mockDriverRepo as DriverRepository,
      undefined,
      mockRideRepo as RideRepository,
    );

    const history = await service.getDriverHistory('user-1', 20, true);

    expect(history.totalEarnings).toBe(0);
    expect(history.rides[0]?.finalFare).toBeUndefined();
    expect(history.rides[0]?.fareEstimate).toBeUndefined();
  });
});

describe('Driver Online Eligibility & Assignment Code Claiming', () => {
  it('blocks driver from going online if profile is not approved', async () => {
    const mockDriverRepo: Partial<DriverRepository> = {
      getAvailability: vi.fn().mockResolvedValue('unavailable'),
      findProfileByUserId: vi.fn().mockResolvedValue({
        id: 'p-1',
        userId: 'u-1',
        licenseNumber: 'DL-12345',
        licenseExpiry: '2030-01-01',
        verificationStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateAvailability: vi.fn(),
    };

    const service = new DriverService(mockDriverRepo as DriverRepository);

    await expect(
      service.updateAvailability('u-1', { status: 'available' }),
    ).rejects.toThrow('Only eligible and approved drivers can go online');

    expect(mockDriverRepo.updateAvailability).not.toHaveBeenCalled();
  });

  it('blocks driver from going online if driving license has expired', async () => {
    const mockDriverRepo: Partial<DriverRepository> = {
      getAvailability: vi.fn().mockResolvedValue('unavailable'),
      findProfileByUserId: vi.fn().mockResolvedValue({
        id: 'p-1',
        userId: 'u-1',
        licenseNumber: 'DL-12345',
        licenseExpiry: '2020-01-01', // Expired!
        verificationStatus: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateAvailability: vi.fn(),
    };

    const service = new DriverService(mockDriverRepo as DriverRepository);

    await expect(
      service.updateAvailability('u-1', { status: 'available' }),
    ).rejects.toThrow('Driving license has expired');

    expect(mockDriverRepo.updateAvailability).not.toHaveBeenCalled();
  });

  it('verifies and claims assignment code', async () => {
    const mockDriverRepo: Partial<DriverRepository> = {
      findProfileIdByUserId: vi.fn().mockResolvedValue('p-1'),
      verifyAssignmentCode: vi.fn().mockResolvedValue({
        vehicleId: 'v-1',
        make: 'Maruti',
        model: 'Dzire',
        plateNumber: 'KA-01-EQ-9999',
        fleetOwnerName: 'Fleet Corp',
      }),
      claimAssignmentCode: vi.fn().mockResolvedValue({
        vehicleId: 'v-1',
        make: 'Maruti',
        model: 'Dzire',
        plateNumber: 'KA-01-EQ-9999',
      }),
    };

    const service = new DriverService(mockDriverRepo as DriverRepository);

    const info = await service.verifyAssignmentCode('u-1', 'FLEET-54321');
    expect(info?.plateNumber).toBe('KA-01-EQ-9999');

    const claimed = await service.claimAssignmentCode('u-1', 'FLEET-54321');
    expect(claimed?.vehicleId).toBe('v-1');
  });
});
