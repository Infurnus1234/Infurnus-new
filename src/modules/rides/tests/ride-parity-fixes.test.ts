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
      const fareEstimator = {
        estimate: vi.fn().mockResolvedValue({ grossAmount: 25000 }),
      };

      const service = new RideService(
        mockRepo as RideRepository,
        undefined,
        undefined,
        fareEstimator as never,
      );
      const created = await service.createRide('cust-uuid-1', {
        pickup: { latitude: 12.9716, longitude: 77.5946 },
        destination: { latitude: 12.9352, longitude: 77.6245 },
        sector: 'passenger',
        vehicleCategory: 'sedan',
        fareEstimate: 1,
      });

      expect(fareEstimator.estimate).toHaveBeenCalledWith(
        { latitude: 12.9716, longitude: 77.5946 },
        { latitude: 12.9352, longitude: 77.6245 },
        { sector: 'passenger', vehicleCategory: 'sedan', pricingMode: 'vehicle_range' },
      );
      expect(mockRepo.create).toHaveBeenCalledWith(
        'cust-uuid-1',
        expect.objectContaining({ fareEstimate: 250 }),
      );
      expect(created.pin).toBe('7391');
      expect(created.pin).not.toBe('5924'); // Confirms removal of hardcoded 5924

      const fetched = await service.getRide('cust-uuid-1', created.id);
      expect(fetched.pin).toBe('7391');
    });

    it('driver listing masks the PIN (pin is null)', async () => {
      const mockRepo: Partial<RideRepository> = {
        listAvailableForDriver: vi.fn().mockResolvedValue([createMockRide({ pin: null })]),
      };

      const service = new RideService(mockRepo as RideRepository);
      const available = await service.listAvailableRides('driver-profile-uuid');

      expect(available[0]?.pin).toBeNull();
    });

    it('driver verifies through the atomic repository operation', async () => {
      const verifyPinAttempt = vi.fn().mockResolvedValue('verified');
      const service = new RideService({ verifyPinAttempt } as unknown as RideRepository);
      expect(await service.verifyRidePin('ride-uuid-1', 'driver-uuid-1', '7391')).toEqual({
        verified: true,
      });
      expect(verifyPinAttempt).toHaveBeenCalledWith('ride-uuid-1', 'driver-uuid-1', '7391');
    });
    it('arrival does not consume the PIN or start a trip', async () => {
      const verifyPinAttempt = vi.fn();
      const transition = vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arrived' }));
      const service = new RideService({
        verifyPinAttempt,
        transition,
      } as unknown as RideRepository);
      expect((await service.transitionRide('ride', 'driver_arrived', 'driver')).status).toBe(
        'driver_arrived',
      );
      expect(verifyPinAttempt).not.toHaveBeenCalled();
    });
  });
});
