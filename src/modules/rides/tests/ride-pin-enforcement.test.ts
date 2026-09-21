import { describe, expect, it, vi } from 'vitest';
import { RideService } from '../services/ride.service.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { Ride } from '../types/ride.js';

describe('Phase 4 Step 8: Strict PIN Enforcement & Lifecycle Protection', () => {
  const createMockRide = (overrides?: Partial<Ride>): Ride => ({
    id: 'ride-pin-test-uuid',
    customerId: 'cust-uuid-1',
    assignedDriverId: 'driver-uuid-1',
    assignedVehicleId: 'veh-uuid-1',
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    destination: { latitude: 12.9352, longitude: 77.6245 },
    pickupAddress: 'MG Road, Bengaluru',
    destinationAddress: 'Koramangala, Bengaluru',
    status: 'driver_arrived',
    fareEstimate: 300,
    finalFare: null,
    actualDistanceMeters: null,
    actualFuelCost: null,
    sector: 'passenger',
    vehicleCategory: 'sedan',
    goods: null,
    serviceDetails: null,
    rentalDetails: null,
    pin: '6789',
    pinVerified: false,
    driverDetails: {
      id: 'driver-uuid-1',
      name: 'Ramesh Patel',
      phone: '+919876543210',
      rating: 4.9,
      photoUrl: null,
    },
    vehicleDetails: {
      make: 'Hyundai',
      model: 'Verna',
      color: 'White',
      plateNumber: 'KA-05-XY-9876',
    },
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('1. Transition to IN_PROGRESS Rejection Without PIN Verification', () => {
    it('rejects direct transition to in_progress if PIN has not been verified (409 PIN_VERIFICATION_REQUIRED)', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arrived', pinVerified: false })),
        isPinVerified: vi.fn().mockResolvedValue(false),
        transition: vi.fn(),
      };

      const service = new RideService(mockRepo as RideRepository);

      await expect(
        service.transitionRide('ride-pin-test-uuid', 'in_progress', 'driver-uuid-1'),
      ).rejects.toThrow('Ride pickup PIN must be verified before starting the trip');

      expect(mockRepo.transition).not.toHaveBeenCalled();
    });

    it('rejects transition if client attempts to pass status in_progress without valid PIN (no bypass)', async () => {
      let isVerified = false;
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arrived', pinVerified: false })),
        isPinVerified: vi.fn().mockImplementation(async () => isVerified),
        getRidePin: vi.fn().mockResolvedValue('6789'),
        markPinVerified: vi.fn().mockImplementation(async () => {
          isVerified = true;
          return true;
        }),
        transition: vi.fn().mockResolvedValue(createMockRide({ status: 'in_progress', pinVerified: true })),
      };

      const service = new RideService(mockRepo as RideRepository);

      // Transition with wrong pin fails
      await expect(
        service.transitionRide('ride-pin-test-uuid', 'in_progress', 'driver-uuid-1', '0000'),
      ).rejects.toThrow('Invalid ride verification PIN');

      expect(isVerified).toBe(false);
      expect(mockRepo.transition).not.toHaveBeenCalled();
    });
  });

  describe('2. PIN Format & Value Validation', () => {
    it('rejects malformed PINs (not exactly 4 digits)', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arrived' })),
        getRidePin: vi.fn().mockResolvedValue('6789'),
      };

      const service = new RideService(mockRepo as RideRepository);

      await expect(
        service.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', '12'),
      ).rejects.toThrow('PIN must be exactly 4 digits');

      await expect(
        service.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', '12345'),
      ).rejects.toThrow('PIN must be exactly 4 digits');

      await expect(
        service.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', 'abcd'),
      ).rejects.toThrow('PIN must be exactly 4 digits');

      await expect(
        service.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', ''),
      ).rejects.toThrow('PIN must be exactly 4 digits');
    });

    it('rejects incorrect PIN with INVALID_PIN error', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arrived' })),
        getRidePin: vi.fn().mockResolvedValue('6789'),
        markPinVerified: vi.fn(),
      };

      const service = new RideService(mockRepo as RideRepository);

      await expect(
        service.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', '9999'),
      ).rejects.toThrow('Invalid ride verification PIN');

      expect(mockRepo.markPinVerified).not.toHaveBeenCalled();
    });
  });

  describe('3. Successful Verification & Atomic Transition', () => {
    it('successfully verifies correct PIN and marks pinVerified', async () => {
      let isVerified = false;
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arrived' })),
        getRidePin: vi.fn().mockResolvedValue('6789'),
        markPinVerified: vi.fn().mockImplementation(async () => {
          isVerified = true;
          return true;
        }),
      };

      const service = new RideService(mockRepo as RideRepository);
      const res = await service.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', '6789');

      expect(res.verified).toBe(true);
      expect(isVerified).toBe(true);
      expect(mockRepo.markPinVerified).toHaveBeenCalledWith('ride-pin-test-uuid');
    });

    it('successfully starts ride when verified PIN is supplied in transition payload', async () => {
      let isVerified = false;
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arrived' })),
        getRidePin: vi.fn().mockResolvedValue('6789'),
        isPinVerified: vi.fn().mockImplementation(async () => isVerified),
        markPinVerified: vi.fn().mockImplementation(async () => {
          isVerified = true;
          return true;
        }),
        transition: vi.fn().mockResolvedValue(createMockRide({ status: 'in_progress', pinVerified: true })),
      };

      const service = new RideService(mockRepo as RideRepository);
      const ride = await service.transitionRide(
        'ride-pin-test-uuid',
        'in_progress',
        'driver-uuid-1',
        '6789',
      );

      expect(ride.status).toBe('in_progress');
      expect(isVerified).toBe(true);
      expect(mockRepo.transition).toHaveBeenCalledWith('ride-pin-test-uuid', 'in_progress', 'driver-uuid-1');
    });

    it('successfully starts ride when PIN was already verified in a prior step', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arrived', pinVerified: true })),
        isPinVerified: vi.fn().mockResolvedValue(true),
        transition: vi.fn().mockResolvedValue(createMockRide({ status: 'in_progress', pinVerified: true })),
      };

      const service = new RideService(mockRepo as RideRepository);
      const ride = await service.transitionRide('ride-pin-test-uuid', 'in_progress', 'driver-uuid-1');

      expect(ride.status).toBe('in_progress');
      expect(mockRepo.transition).toHaveBeenCalledWith('ride-pin-test-uuid', 'in_progress', 'driver-uuid-1');
    });
  });

  describe('4. Idempotency & State Prerequisite Enforcement', () => {
    it('idempotently verifies PIN when already marked verified', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arrived', pinVerified: true })),
        getRidePin: vi.fn().mockResolvedValue('6789'),
        markPinVerified: vi.fn().mockResolvedValue(true),
      };

      const service = new RideService(mockRepo as RideRepository);
      const res1 = await service.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', '6789');
      const res2 = await service.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', '6789');

      expect(res1.verified).toBe(true);
      expect(res2.verified).toBe(true);
    });

    it('rejects transition to in_progress from status other than driver_arrived', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'driver_arriving', pinVerified: true })),
        isPinVerified: vi.fn().mockResolvedValue(true),
        transition: vi.fn(),
      };

      const service = new RideService(mockRepo as RideRepository);

      await expect(
        service.transitionRide('ride-pin-test-uuid', 'in_progress', 'driver-uuid-1', '6789'),
      ).rejects.toThrow("Cannot start ride from 'driver_arriving' state");

      expect(mockRepo.transition).not.toHaveBeenCalled();
    });

    it('rejects PIN verification if ride is cancelled or completed', async () => {
      const cancelledMockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'cancelled' })),
      };

      const serviceCancelled = new RideService(cancelledMockRepo as RideRepository);
      await expect(
        serviceCancelled.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', '6789'),
      ).rejects.toThrow("Cannot verify PIN for ride in 'cancelled' status");

      const completedMockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
        findById: vi.fn().mockResolvedValue(createMockRide({ status: 'completed' })),
      };

      const serviceCompleted = new RideService(completedMockRepo as RideRepository);
      await expect(
        serviceCompleted.verifyRidePin('ride-pin-test-uuid', 'driver-uuid-1', '6789'),
      ).rejects.toThrow("Cannot verify PIN for ride in 'completed' status");
    });
  });

  describe('5. Authorization & Driver Assignment Enforcement', () => {
    it('rejects PIN verification attempt by unassigned driver with FORBIDDEN (403)', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(false),
      };

      const service = new RideService(mockRepo as RideRepository);

      await expect(
        service.verifyRidePin('ride-pin-test-uuid', 'intruder-driver-uuid', '6789'),
      ).rejects.toThrow('Not assigned to this ride');
    });

    it('rejects transition to in_progress if driver profile is not assigned', async () => {
      const mockRepo: Partial<RideRepository> = {
        isAssignedDriverProfile: vi.fn().mockResolvedValue(false),
      };

      const service = new RideService(mockRepo as RideRepository);

      await expect(
        service.transitionRide('ride-pin-test-uuid', 'in_progress', 'unassigned-driver', '6789'),
      ).rejects.toThrow('Not assigned to this ride');
    });
  });

  describe('6. Multi-Sector Strict PIN Enforcement', () => {
    const sectors = ['passenger', 'logistics', 'service', 'premium'] as const;

    for (const sector of sectors) {
      it(`enforces strict PIN verification for ${sector} sector ride`, async () => {
        let isVerified = false;
        const mockRepo: Partial<RideRepository> = {
          isAssignedDriverProfile: vi.fn().mockResolvedValue(true),
          findById: vi.fn().mockResolvedValue(createMockRide({ sector, status: 'driver_arrived' })),
          getRidePin: vi.fn().mockResolvedValue('5555'),
          isPinVerified: vi.fn().mockImplementation(async () => isVerified),
          markPinVerified: vi.fn().mockImplementation(async () => {
            isVerified = true;
            return true;
          }),
          transition: vi.fn().mockResolvedValue(createMockRide({ sector, status: 'in_progress', pinVerified: true })),
        };

        const service = new RideService(mockRepo as RideRepository);

        // Attempt without PIN
        await expect(
          service.transitionRide('ride-pin-test-uuid', 'in_progress', 'driver-uuid-1'),
        ).rejects.toThrow('Ride pickup PIN must be verified before starting the trip');

        // With correct PIN
        const started = await service.transitionRide(
          'ride-pin-test-uuid',
          'in_progress',
          'driver-uuid-1',
          '5555',
        );
        expect(started.status).toBe('in_progress');
        expect(isVerified).toBe(true);
      });
    }
  });
});
