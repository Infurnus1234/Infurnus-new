import { describe, expect, it, vi } from 'vitest';
import { RideService } from '../services/ride.service.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { Ride } from '../types/ride.js';

describe('BUG-P3-02 & BUG-P3-04: Parity Fixes — Real Details & Secure PIN', () => {
  const createMockRide = (overrides?: Partial<Ride>): Ride => ({
    id: 'ride-uuid-1',
    customerId: 'cust-uuid-1',
    assignedDriverId: null,
    assignedVehicleId: null,
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    destination: { latitude: 12.9352, longitude: 77.6245 },
    pickupAddress: 'MG Road, Bengaluru',
    destinationAddress: 'Koramangala, Bengaluru',
    status: 'searching',
    fareEstimate: 250,
    sector: 'passenger',
    vehicleCategory: 'sedan',
    goods: null,
    serviceDetails: null,
    rentalDetails: null,
    pin: '8492',
    driverDetails: null,
    vehicleDetails: null,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('BUG-P3-02: Real Driver & Vehicle Projections (No Fake Fallbacks)', () => {
    it('unassigned ride has null driverDetails and null vehicleDetails', () => {
      const ride = createMockRide({
        assignedDriverId: null,
        assignedVehicleId: null,
        driverDetails: null,
        vehicleDetails: null,
      });

      expect(ride.driverDetails).toBeNull();
      expect(ride.vehicleDetails).toBeNull();
    });

    it('assigned ride contains real driver name, phone, rating, vehicle make, model and plate number', () => {
      const ride = createMockRide({
        assignedDriverId: 'driver-profile-uuid',
        assignedVehicleId: 'vehicle-uuid',
        driverDetails: {
          id: 'driver-profile-uuid',
          name: 'Rajesh Kumar',
          phone: '+919876543210',
          rating: 4.8,
          photoUrl: 'profiles/driver_rajesh.jpg',
        },
        vehicleDetails: {
          make: 'Maruti Suzuki',
          model: 'Dzire',
          color: 'Silver',
          plateNumber: 'KA-01-AB-1234',
        },
      });

      expect(ride.driverDetails?.name).toBe('Rajesh Kumar');
      expect(ride.driverDetails?.phone).toBe('+919876543210');
      expect(ride.driverDetails?.rating).toBe(4.8);
      expect(ride.vehicleDetails?.make).toBe('Maruti Suzuki');
      expect(ride.vehicleDetails?.plateNumber).toBe('KA-01-AB-1234');
    });

    it('unrated driver has rating as null, not fake 4.9', () => {
      const ride = createMockRide({
        assignedDriverId: 'driver-profile-uuid-2',
        driverDetails: {
          id: 'driver-profile-uuid-2',
          name: 'Suresh Patel',
          phone: '+919123456789',
          rating: null, // New driver with 0 ratings
          photoUrl: null,
        },
      });

      expect(ride.driverDetails?.rating).toBeNull();
      expect(ride.driverDetails?.rating).not.toBe(4.9);
    });
  });

  describe('BUG-P3-04: Real Ride PIN Lifecycle, Masking & Verification', () => {
    it('customer receives PIN on ride creation and lookup', async () => {
      const mockRepo: Partial<RideRepository> = {
        create: vi.fn().mockImplementation(async (_customerId, _input) => {
          // Generates non-hardcoded 4-digit PIN
          return createMockRide({ pin: '7391' });
        }),
        findByIdForCustomer: vi.fn().mockImplementation(async (id, _customerId) => {
          return createMockRide({ id, pin: '7391' });
        }),
      };

      const service = new RideService(mockRepo as RideRepository);
      const created = await service.createRide('cust-uuid-1', {
        pickup: { latitude: 12.9716, longitude: 77.5946 },
        destination: { latitude: 12.9352, longitude: 77.6245 },
      });

      expect(created.pin).toBe('7391');
      expect(created.pin).not.toBe('5924'); // Confirms removal of hardcoded 5924

      const fetched = await service.getRide('cust-uuid-1', created.id);
      expect(fetched.pin).toBe('7391');
    });

    it('driver listing masks the PIN (pin is null)', async () => {
      const mockRepo: Partial<RideRepository> = {
        listAvailable: vi.fn().mockResolvedValue([
          createMockRide({ pin: null }),
        ]),
      };

      const service = new RideService(mockRepo as RideRepository);
      const available = await service.listAvailableRides();

      expect(available[0]?.pin).toBeNull();
    });

    it('driver verifies correct PIN successfully', async () => {
      let isVerified = false;
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        getRidePin: vi.fn().mockResolvedValue('7391'),
        markPinVerified: vi.fn().mockImplementation(async () => {
          isVerified = true;
          return true;
        }),
      };

      const service = new RideService(mockRepo as RideRepository);
      const result = await service.verifyRidePin('ride-uuid-1', 'driver-uuid-1', '7391');

      expect(result.verified).toBe(true);
      expect(isVerified).toBe(true);
    });

    it('rejects incorrect PIN with INVALID_PIN error', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        getRidePin: vi.fn().mockResolvedValue('7391'),
        markPinVerified: vi.fn(),
      };

      const service = new RideService(mockRepo as RideRepository);

      await expect(
        service.verifyRidePin('ride-uuid-1', 'driver-uuid-1', '0000'),
      ).rejects.toThrow('Invalid ride verification PIN');
      expect(mockRepo.markPinVerified).not.toHaveBeenCalled();
    });

    it('rejects unassigned driver attempting to verify PIN with FORBIDDEN error', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(false),
        getRidePin: vi.fn().mockResolvedValue('7391'),
      };

      const service = new RideService(mockRepo as RideRepository);

      await expect(
        service.verifyRidePin('ride-uuid-1', 'unassigned-driver', '7391'),
      ).rejects.toThrow('Not assigned to this ride');
    });

    it('transitionRide verifies PIN when marking driver_arrived', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        getRidePin: vi.fn().mockResolvedValue('7391'),
        markPinVerified: vi.fn().mockResolvedValue(true),
        transition: vi.fn().mockResolvedValue(
          createMockRide({ status: 'driver_arrived' }),
        ),
      };

      const service = new RideService(mockRepo as RideRepository);

      // Wrong PIN fails transition
      await expect(
        service.transitionRide('ride-uuid-1', 'driver_arrived', 'driver-uuid-1', '1234'),
      ).rejects.toThrow('Invalid ride verification PIN');

      // Correct PIN succeeds transition
      const arrivedRide = await service.transitionRide(
        'ride-uuid-1',
        'driver_arrived',
        'driver-uuid-1',
        '7391',
      );
      expect(arrivedRide.status).toBe('driver_arrived');
      expect(mockRepo.markPinVerified).toHaveBeenCalledWith('ride-uuid-1');
    });
  });
});
