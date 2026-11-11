import { describe, expect, it, vi } from 'vitest';
import { RideService } from '../services/ride.service.js';
import type { RideRepository } from '../repositories/ride.repository.js';
import type { DriverRepository } from '../repositories/driver.repository.js';
import {
  generateRidePin,
  endPinVerifier,
  sealRideEndPin,
  openRideEndPin,
  matchesEndPinVerifier,
  evaluateEndPinAttempt,
} from '../repositories/ride-pin.js';
import { sanitizeRideForDriver } from '../utils/ride-sanitizer.js';
import type { Ride } from '../types/ride.js';

describe('Logistics Two-OTP: End Delivery PIN Contract', () => {
  it('seals and opens end PIN and validates matching HMAC verifier', () => {
    const pin = generateRidePin();
    expect(pin).toMatch(/^\d{4}$/);
    const sealed = sealRideEndPin('ride-123', pin);
    expect(openRideEndPin('ride-123', sealed)).toBe(pin);
    expect(() => openRideEndPin('ride-wrong', sealed)).toThrow();
    const verifier = endPinVerifier('ride-123', pin);
    expect(matchesEndPinVerifier('ride-123', pin, verifier)).toBe(true);
    expect(matchesEndPinVerifier('ride-123', '9999' === pin ? '0000' : '9999', verifier)).toBe(
      false,
    );
  });

  it('evaluates end PIN attempt lockout correctly after max attempts', () => {
    const now = Date.now();
    let metadata: Record<string, unknown> = {};

    for (let i = 1; i < 5; i++) {
      const res = evaluateEndPinAttempt('match', 'wrong', metadata, now);
      expect(res.result).toBe('invalid');
      expect(res.metadata.endPinFailedAttempts).toBe(i);
      metadata = res.metadata;
    }

    const lockedRes = evaluateEndPinAttempt('match', 'wrong', metadata, now);
    expect(lockedRes.result).toBe('locked');
    expect(lockedRes.metadata.endPinFailedAttempts).toBe(5);
    expect(Number(lockedRes.metadata.endPinLockedUntil)).toBeGreaterThan(now);

    const blockedRes = evaluateEndPinAttempt('match', 'match', lockedRes.metadata, now + 1000);
    expect(blockedRes.result).toBe('locked');
  });

  describe('RideService completion gating', () => {
    const mockDriverRepo = {
      releaseBusy: vi.fn().mockResolvedValue(true),
    } as unknown as DriverRepository;

    const mockTransactionRunner = vi.fn(async (callback) =>
      callback({
        query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
      } as never),
    );

    it('rejects logistics completion when endPin is missing', async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'logistics-ride-1',
          sector: 'logistics',
          status: 'in_progress',
          assignedDriverId: 'driver-1',
        }),
      } as unknown as RideRepository;

      const service = new RideService(mockRepo, mockDriverRepo);

      await expect(service.completeRide('logistics-ride-1', 'driver-1')).rejects.toMatchObject({
        code: 'END_PIN_REQUIRED',
        statusCode: 400,
      });
    });

    it('rejects logistics completion when endPin is invalid format', async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'logistics-ride-1',
          sector: 'logistics',
          status: 'in_progress',
          assignedDriverId: 'driver-1',
        }),
      } as unknown as RideRepository;

      const service = new RideService(mockRepo, mockDriverRepo);

      await expect(
        service.completeRide('logistics-ride-1', 'driver-1', '12'),
      ).rejects.toMatchObject({
        code: 'INVALID_PIN',
        statusCode: 400,
      });
    });

    it('rejects logistics completion when wrong endPin is provided', async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'logistics-ride-1',
          sector: 'logistics',
          status: 'in_progress',
          assignedDriverId: 'driver-1',
        }),
        verifyEndPinAttempt: vi.fn().mockResolvedValue('invalid'),
      } as unknown as RideRepository;

      const service = new RideService(mockRepo, mockDriverRepo);

      await expect(
        service.completeRide('logistics-ride-1', 'driver-1', '0000'),
      ).rejects.toMatchObject({
        code: 'INVALID_END_PIN',
        statusCode: 400,
      });
    });

    it('rejects logistics completion when locked due to exceeded attempts', async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'logistics-ride-1',
          sector: 'logistics',
          status: 'in_progress',
          assignedDriverId: 'driver-1',
        }),
        verifyEndPinAttempt: vi.fn().mockResolvedValue('locked'),
      } as unknown as RideRepository;

      const service = new RideService(mockRepo, mockDriverRepo);

      await expect(
        service.completeRide('logistics-ride-1', 'driver-1', '0000'),
      ).rejects.toMatchObject({
        code: 'END_PIN_ATTEMPTS_EXCEEDED',
        statusCode: 429,
      });
    });

    it('completes logistics ride when correct endPin is provided', async () => {
      const completedRide: Ride = {
        id: 'logistics-ride-1',
        customerId: 'customer-1',
        sector: 'logistics',
        status: 'completed',
        assignedDriverId: 'driver-1',
        assignedVehicleId: 'veh-1',
        pickup: { latitude: 12.9, longitude: 77.6 },
        destination: { latitude: 12.95, longitude: 77.65 },
        pickupAddress: null,
        destinationAddress: null,
        cancellationReason: null,
        cancelledAt: null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'logistics-ride-1',
          sector: 'logistics',
          status: 'in_progress',
          assignedDriverId: 'driver-1',
        }),
        verifyEndPinAttempt: vi.fn().mockResolvedValue('verified'),
        complete: vi.fn().mockResolvedValue(completedRide),
      } as unknown as RideRepository;

      const service = new RideService(
        mockRepo,
        mockDriverRepo,
        undefined,
        undefined,
        mockTransactionRunner,
      );
      const result = await service.completeRide('logistics-ride-1', 'driver-1', '1234');
      expect(result.status).toBe('completed');
      expect(mockRepo.verifyEndPinAttempt).toHaveBeenCalledWith(
        'logistics-ride-1',
        'driver-1',
        '1234',
      );
      expect(mockRepo.complete).toHaveBeenCalled();
    });

    it('completes non-logistics ride without any endPin (regression check)', async () => {
      const completedPassengerRide: Ride = {
        id: 'passenger-ride-1',
        customerId: 'customer-1',
        sector: 'passenger',
        status: 'completed',
        assignedDriverId: 'driver-1',
        assignedVehicleId: 'veh-1',
        pickup: { latitude: 12.9, longitude: 77.6 },
        destination: { latitude: 12.95, longitude: 77.65 },
        pickupAddress: null,
        destinationAddress: null,
        cancellationReason: null,
        cancelledAt: null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'passenger-ride-1',
          sector: 'passenger',
          status: 'in_progress',
          assignedDriverId: 'driver-1',
        }),
        verifyEndPinAttempt: vi.fn(),
        complete: vi.fn().mockResolvedValue(completedPassengerRide),
      } as unknown as RideRepository;

      const service = new RideService(
        mockRepo,
        mockDriverRepo,
        undefined,
        undefined,
        mockTransactionRunner,
      );
      const result = await service.completeRide('passenger-ride-1', 'driver-1');
      expect(result.status).toBe('completed');
      expect(mockRepo.verifyEndPinAttempt).not.toHaveBeenCalled();
      expect(mockRepo.complete).toHaveBeenCalled();
    });
  });

  describe('Driver API response security', () => {
    it('never contains pin or endPin in sanitizeRideForDriver', () => {
      const rideWithPins: Ride = {
        id: 'logistics-ride-1',
        customerId: 'customer-1',
        sector: 'logistics',
        status: 'in_progress',
        assignedDriverId: 'driver-1',
        assignedVehicleId: 'veh-1',
        pickup: { latitude: 12.9, longitude: 77.6 },
        destination: { latitude: 12.95, longitude: 77.65 },
        pickupAddress: 'Pickup St',
        destinationAddress: 'Drop St',
        pin: '1234',
        endPin: '5678',
        cancellationReason: null,
        cancelledAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const driverSafe = sanitizeRideForDriver(rideWithPins);
      expect((driverSafe as Record<string, unknown>).pin).toBeUndefined();
      expect((driverSafe as Record<string, unknown>).endPin).toBeUndefined();
      expect((driverSafe as Record<string, unknown>).endPinCiphertext).toBeUndefined();
      expect((driverSafe as Record<string, unknown>).endPinVerifier).toBeUndefined();
    });
  });
});
