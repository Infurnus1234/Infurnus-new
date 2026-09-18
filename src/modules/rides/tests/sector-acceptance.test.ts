import { describe, expect, it, vi } from 'vitest';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { RideService } from '../services/ride.service.js';
import { MatchingService } from '../services/matching.service.js';
import { AppError } from '../../../common/errors/app-error.js';

describe('Phase 4 Step 3: Sector & Category Matching and Acceptance Isolation', () => {
  describe('MatchingService & PostgresDriverRepository Sector Filtering', () => {
    it('passes sector and vehicleCategory to driver repository findNearbyEligible', async () => {
      const findNearbyMock = vi.fn().mockResolvedValue([
        {
          driverProfileId: 'driver-logistics-1',
          userId: 'user-logistics-1',
          vehicleId: 'veh-logistics-1',
          distanceMeters: 500,
          latitude: 12.97,
          longitude: 77.59,
          availabilityStatus: 'available',
          verificationStatus: 'approved',
          activeRideCount: 0,
          locationRecordedAt: new Date(),
          sector: 'logistics',
          vehicleCategory: 'mini_truck',
        },
      ]);

      const driverRepo = {
        findNearbyEligible: findNearbyMock,
      };

      const matching = new MatchingService(driverRepo as never);
      const best = await matching.findBestDriver(
        { latitude: 12.97, longitude: 77.59 },
        'logistics',
        'mini_truck',
      );

      expect(findNearbyMock).toHaveBeenCalledWith(
        12.97,
        77.59,
        expect.any(Number),
        expect.any(Number),
        expect.any(Date),
        'logistics',
        'mini_truck',
      );
      expect(best?.sector).toBe('logistics');
      expect(best?.vehicleCategory).toBe('mini_truck');
    });

    it('PostgresDriverRepository.findNearbyEligible executes SQL with sector and category filters', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          {
            driverProfileId: 'dp-service-1',
            userId: 'user-service-1',
            vehicleId: 'veh-jcb-1',
            distanceMeters: 250,
            latitude: 12.9,
            longitude: 77.6,
            availabilityStatus: 'available',
            verificationStatus: 'approved',
            locationRecordedAt: new Date(),
            activeRideCount: 0,
            sector: 'service',
            vehicleCategory: 'jcb',
          },
        ],
      });

      const poolMock = { query: queryMock };
      const repo = new PostgresDriverRepository(poolMock as never);

      const candidates = await repo.findNearbyEligible(
        12.9,
        77.6,
        5000,
        10,
        new Date(),
        'service',
        'jcb',
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.sector).toBe('service');
      expect(candidates[0]?.vehicleCategory).toBe('jcb');

      const sql = queryMock.mock.calls[0]![0] as string;
      const params = queryMock.mock.calls[0]![1] as unknown[];

      expect(sql).toContain('($6::varchar IS NULL OR v.sector = $6)');
      expect(sql).toContain('($7::varchar IS NULL OR v.category = $7)');
      expect(params[5]).toBe('service');
      expect(params[6]).toBe('jcb');
    });
  });

  describe('PostgresRideRepository.accept Sector & Category Enforcement', () => {
    it('generates SQL enforcing v.sector = r.sector and category match', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        rows: [],
      });
      const clientMock = { query: queryMock };
      const repo = new PostgresRideRepository({ query: vi.fn() } as never);

      const result = await repo.accept('ride-123', 'driver-profile-1', clientMock as never);

      expect(result).toBeNull();
      const sql = queryMock.mock.calls[0]![0] as string;
      expect(sql).toContain('v.sector = r.sector');
      expect(sql).toContain('(r.vehicle_category IS NULL OR v.category = r.vehicle_category)');
    });

    it('returns mapped ride when matching vehicle sector and category accepts', async () => {
      const now = new Date();
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'ride-matching-1',
            customerId: 'cust-1',
            assignedDriverId: 'driver-prof-1',
            assignedVehicleId: 'veh-suv-1',
            pickupLatitude: 12.9,
            pickupLongitude: 77.6,
            destinationLatitude: 12.95,
            destinationLongitude: 77.65,
            status: 'driver_assigned',
            sector: 'passenger',
            vehicleCategory: 'suv',
            fareEstimate: 350,
            finalFare: null,
            actualDistanceMeters: 0,
            actualFuelCost: null,
            pin: '4321',
            pinVerified: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });

      const clientMock = { query: queryMock };
      const repo = new PostgresRideRepository({ query: vi.fn() } as never);

      const ride = await repo.accept('ride-matching-1', 'driver-prof-1', clientMock as never);

      expect(ride).not.toBeNull();
      expect(ride?.id).toBe('ride-matching-1');
      expect(ride?.status).toBe('driver_assigned');
      expect(ride?.sector).toBe('passenger');
      expect(ride?.vehicleCategory).toBe('suv');
    });
  });

  describe('RideService Acceptance Conflict & Race Condition Protection', () => {
    it('throws RIDE_ACCEPTANCE_CONFLICT when driver vehicle sector/category does not match', async () => {
      const rideRepo = {
        accept: vi.fn().mockResolvedValue(null), // DB update returns 0 rows due to sector/category mismatch
      };
      const driverRepo = {
        setBusy: vi.fn().mockResolvedValue(true),
      };

      const service = new RideService(rideRepo as never, driverRepo as never);

      await expect(service.acceptRide('driver-wrong-sector', 'ride-logistics')).rejects.toThrow(
        expect.objectContaining({
          code: 'RIDE_ACCEPTANCE_CONFLICT',
          statusCode: 409,
        }),
      );
    });

    it('throws DRIVER_CONTENTION_CONFLICT when driver is already busy with another ride', async () => {
      const rideRepo = {
        accept: vi.fn().mockResolvedValue({ id: 'ride-1', status: 'driver_assigned' }),
      };
      const driverRepo = {
        setBusy: vi.fn().mockResolvedValue(false), // driver contention!
      };

      const service = new RideService(rideRepo as never, driverRepo as never);

      await expect(service.acceptRide('driver-busy', 'ride-1')).rejects.toThrow(
        expect.objectContaining({
          code: 'DRIVER_CONTENTION_CONFLICT',
          statusCode: 409,
        }),
      );
    });

    it('throws DRIVER_CONTENTION_CONFLICT on unique constraint violation (code 23505)', async () => {
      const pgError = new Error('duplicate key value violates unique constraint');
      Object.assign(pgError, { code: '23505' });

      const rideRepo = {
        accept: vi.fn().mockRejectedValue(pgError),
      };

      const service = new RideService(rideRepo as never);

      await expect(service.acceptRide('driver-busy', 'ride-1')).rejects.toThrow(
        expect.objectContaining({
          code: 'DRIVER_CONTENTION_CONFLICT',
          statusCode: 409,
        }),
      );
    });
  });
});
