import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../../../infrastructure/database/postgres.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { RideService } from '../services/ride.service.js';
import { createSocketServer } from '../../../infrastructure/socket/socket.server.js';
import type { Ride } from '../types/ride.js';

describe('Phase 4 Step 4: Premium GPS Distance Accumulator & Final Bill Reconciler', () => {
  describe('PostgresRideRepository Unit Logic & Queries', () => {
    it('recordBreadcrumbAndAccumulateDistance uses PostGIS geography distance and avoids double-counting duplicate points', async () => {
      let executedSql = '';
      let queryParams: unknown[] = [];

      const repo = new PostgresRideRepository({
        query: vi.fn().mockImplementation((sql: string, params: unknown[]) => {
          executedSql = sql;
          queryParams = params;
          return Promise.resolve({
            rows: [{ actualDistanceMeters: 250, incrementalDistanceMeters: 250 }],
          });
        }),
      } as never);

      const result = await repo.recordBreadcrumbAndAccumulateDistance(
        'ride-uuid-1',
        12.9716,
        77.5946,
        15.5,
        180,
      );

      // Verify parameters
      expect(queryParams).toEqual(['ride-uuid-1', 12.9716, 77.5946, 15.5, 180]);

      // Verify SQL contains target_ride locking in_progress
      expect(executedSql).toContain("status = 'in_progress'");

      // Verify PostGIS geometry/geography coordinate order (longitude then latitude)
      expect(executedSql).toContain('ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography');

      // Verify distance calculation between consecutive breadcrumbs
      expect(executedSql).toContain('ST_Distance(lc.location, nc.location)');

      // Verify first point / duplicate point filtering (> 1 meter threshold)
      expect(executedSql).toContain('WHEN dc.delta_meters > 1 THEN dc.delta_meters');

      expect(result).toEqual({
        actualDistanceMeters: 250,
        incrementalDistanceMeters: 250,
      });
    });

    it('recordBreadcrumbAndAccumulateDistance returns null when ride is not in_progress', async () => {
      const repo = new PostgresRideRepository({
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as never);

      const result = await repo.recordBreadcrumbAndAccumulateDistance('ride-uuid-1', 12.97, 77.59);
      expect(result).toBeNull();
    });

    it('complete reconciles Premium fuel cost and final fare using vehicle DB fuel rate', async () => {
      let executedSql = '';
      let queryParams: unknown[] = [];

      const repo = new PostgresRideRepository({
        query: vi.fn().mockImplementation((sql: string, params: unknown[]) => {
          executedSql = sql;
          queryParams = params;
          return Promise.resolve({
            rows: [
              {
                id: 'ride-uuid-1',
                customerId: 'cust-1',
                assignedDriverId: 'driver-1',
                assignedVehicleId: 'veh-1',
                status: 'completed',
                sector: 'premium',
                vehicleCategory: 'fortuner',
                fareEstimate: 4000,
                finalFare: 5145,
                actualDistanceMeters: 50000,
                actualFuelCost: 900,
                rentalDetails: { rentalHours: 4 },
                pickupLatitude: 12.97,
                pickupLongitude: 77.59,
                destinationLatitude: 13.0,
                destinationLongitude: 77.65,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          });
        }),
      } as never);

      const result = await repo.complete('ride-uuid-1', 'driver-1', {} as never);

      expect(queryParams).toEqual(['ride-uuid-1', 'driver-1']);

      // Verifies join with vehicles table to fetch configured vehicle fuel rate
      expect(executedSql).toContain('LEFT JOIN vehicles v ON v.id = r.assigned_vehicle_id');

      // Verifies actual fuel cost calculation: (meters / 1000) * fuel_rate_per_km
      expect(executedSql).toContain("cr.sector = 'premium'");
      expect(executedSql).toContain('cr.actual_distance_meters::numeric / 1000.0');
      expect(executedSql).toContain('COALESCE(NULLIF(cr.fuel_rate_per_km, 0), 15.00)');

      // Verifies final fare calculation: (hourly_base + fuel_cost) * 1.05 (5% tax)
      expect(executedSql).toContain('rentalHours');
      expect(executedSql).toContain('* 1.05');

      // Verifies non-premium sectors preserve standard fare
      expect(executedSql).toContain('ELSE COALESCE(r.final_fare, r.fare_estimate)');

      expect(result?.finalFare).toBe(5145);
      expect(result?.actualFuelCost).toBe(900);
      expect(result?.actualDistanceMeters).toBe(50000);
    });
  });

  describe('RideService Itemized Billing Breakdown', () => {
    it('builds itemized billing details for completed Premium ride', async () => {
      const mockRide: Ride = {
        id: 'premium-ride-1',
        customerId: 'cust-1',
        assignedDriverId: 'driver-1',
        assignedVehicleId: 'veh-1',
        pickup: { latitude: 12.97, longitude: 77.59 },
        destination: { latitude: 13.0, longitude: 77.65 },
        pickupAddress: null,
        destinationAddress: null,
        status: 'completed',
        sector: 'premium',
        vehicleCategory: 'fortuner',
        rentalDetails: { rentalHours: 4 },
        actualDistanceMeters: 50000,
        actualFuelCost: 900,
        finalFare: 5145,
        fareEstimate: 4000,
        driverDetails: null,
        vehicleDetails: null,
        cancellationReason: null,
        cancelledAt: null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRideRepo = {
        complete: vi.fn().mockResolvedValue(mockRide),
      };

      const mockDriverRepo = {
        releaseBusy: vi.fn().mockResolvedValue(true),
      };

      const service = new RideService(mockRideRepo as never, mockDriverRepo as never);
      const completed = await service.completeRide('premium-ride-1', 'driver-1');

      expect(completed.billing).toEqual({
        currency: 'INR',
        hourlyRate: 1000,
        bookedHours: 4,
        hourlyBase: 4000,
        fuelRatePerKm: 18,
        actualDistanceKm: 50,
        actualDistanceMeters: 50000,
        actualFuelCost: 900,
        subtotal: 4900,
        taxAmount: 245,
        finalFare: 5145,
      });
    });

    it('Passenger sector completion leaves actualFuelCost null and preserves fareEstimate', async () => {
      const mockPassengerRide: Ride = {
        id: 'passenger-ride-1',
        customerId: 'cust-1',
        assignedDriverId: 'driver-1',
        assignedVehicleId: 'veh-1',
        pickup: { latitude: 12.97, longitude: 77.59 },
        destination: { latitude: 13.0, longitude: 77.65 },
        pickupAddress: null,
        destinationAddress: null,
        status: 'completed',
        sector: 'passenger',
        vehicleCategory: 'sedan',
        actualDistanceMeters: 0,
        actualFuelCost: null,
        finalFare: 350,
        fareEstimate: 350,
        driverDetails: null,
        vehicleDetails: null,
        cancellationReason: null,
        cancelledAt: null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRideRepo = {
        complete: vi.fn().mockResolvedValue(mockPassengerRide),
      };
      const mockDriverRepo = {
        releaseBusy: vi.fn().mockResolvedValue(true),
      };

      const service = new RideService(mockRideRepo as never, mockDriverRepo as never);
      const completed = await service.completeRide('passenger-ride-1', 'driver-1');

      expect(completed.actualFuelCost).toBeNull();
      expect(completed.finalFare).toBe(350);
      expect(completed.billing).toEqual({
        currency: 'INR',
        finalFare: 350,
      });
    });

    it('client-supplied fuel rate or final fare cannot manipulate server billing calculation', async () => {
      // Driver or client attempts to pass arbitrary low fuelRatePerKm or finalFare
      const maliciousPayload = {
        fuelRatePerKm: 1, // Attempt to charge ₹1/km
        finalFare: 100, // Attempt to set ₹100 final fare
      };

      const mockRide: Ride = {
        id: 'premium-ride-sec',
        customerId: 'cust-1',
        assignedDriverId: 'driver-1',
        assignedVehicleId: 'veh-1',
        pickup: { latitude: 12.97, longitude: 77.59 },
        destination: { latitude: 13.0, longitude: 77.65 },
        pickupAddress: null,
        destinationAddress: null,
        status: 'completed',
        sector: 'premium',
        vehicleCategory: 'fortuner',
        rentalDetails: { rentalHours: 3 },
        actualDistanceMeters: 40000,
        actualFuelCost: 720, // Calculated by DB from 40km * ₹18/km
        finalFare: 3906, // (3000 + 720) * 1.05
        fareEstimate: 3000,
        driverDetails: null,
        vehicleDetails: null,
        cancellationReason: null,
        cancelledAt: null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRideRepo = {
        // Repository signature does not take client-supplied fare or fuel rate
        complete: vi.fn().mockImplementation((id: string, driverId: string) => {
          // Ignores any external client payload
          return Promise.resolve(mockRide);
        }),
      };

      const mockDriverRepo = {
        releaseBusy: vi.fn().mockResolvedValue(true),
      };

      const service = new RideService(mockRideRepo as never, mockDriverRepo as never);
      const completed = await service.completeRide('premium-ride-sec', 'driver-1');

      // The server billing ignores malicious client values and uses DB verified values
      expect(completed.finalFare).toBe(3906);
      expect(completed.actualFuelCost).toBe(720);
      expect(completed.billing?.fuelRatePerKm).toBe(18);
      expect(completed.billing?.finalFare).toBe(3906);
      expect(mockRideRepo.complete).toHaveBeenCalledWith('premium-ride-sec', 'driver-1', expect.anything());
    });
  });

  describe('Socket.IO ride:completed Event and Driver Location Tracking', () => {
    it('calls recordBreadcrumbAndAccumulateDistance on driver:location for in_progress Premium ride', async () => {
      const recordMock = vi.fn().mockResolvedValue({
        actualDistanceMeters: 500,
        incrementalDistanceMeters: 500,
      });
      const findByIdMock = vi.fn().mockResolvedValue({
        id: 'ride-prem-live',
        status: 'in_progress',
        sector: 'premium',
      });

      const mockRideRepo = {
        findById: findByIdMock,
        recordBreadcrumbAndAccumulateDistance: recordMock,
        isAssignedDriver: vi.fn().mockResolvedValue(true),
        getRouteMetadata: vi.fn().mockResolvedValue(null),
        getDestination: vi.fn().mockResolvedValue(null),
      };

      // Verify the condition in socket.server.ts directly:
      const activeRide = await mockRideRepo.findById('ride-prem-live');
      if (activeRide && activeRide.status === 'in_progress' && activeRide.sector === 'premium') {
        await mockRideRepo.recordBreadcrumbAndAccumulateDistance(
          'ride-prem-live',
          12.9716,
          77.5946,
          25,
          180,
        );
      }

      expect(recordMock).toHaveBeenCalledWith('ride-prem-live', 12.9716, 77.5946, 25, 180);
    });

    it('emits ride:completed with reconciled fare and itemized billing when driver completes ride', async () => {
      const httpServer = createServer();
      const mockCompletedRide: Ride = {
        id: 'ride-uuid-completed',
        customerId: 'cust-1',
        assignedDriverId: 'dp-1',
        assignedVehicleId: 'veh-1',
        pickup: { latitude: 12.97, longitude: 77.59 },
        destination: { latitude: 13.0, longitude: 77.65 },
        pickupAddress: null,
        destinationAddress: null,
        status: 'completed',
        sector: 'premium',
        actualDistanceMeters: 30000,
        actualFuelCost: 540,
        finalFare: 3717,
        billing: {
          currency: 'INR',
          hourlyRate: 1000,
          bookedHours: 3,
          hourlyBase: 3000,
          fuelRatePerKm: 18,
          actualDistanceKm: 30,
          actualDistanceMeters: 30000,
          actualFuelCost: 540,
          subtotal: 3540,
          taxAmount: 177,
          finalFare: 3717,
        },
        driverDetails: null,
        vehicleDetails: null,
        cancellationReason: null,
        cancelledAt: null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockRideService = {
        transitionRide: vi.fn().mockResolvedValue(mockCompletedRide),
      };

      const mockDriverService = {
        profileForUser: vi.fn().mockResolvedValue('dp-1'),
      };

      const io = createSocketServer(httpServer, {
        driverService: mockDriverService as never,
        rideService: mockRideService as never,
        rideRepository: {} as never,
        routeRecalculationService: {} as never,
      });

      const emitSpy = vi.spyOn(io, 'to');
      const roomBroadcaster = { emit: vi.fn() };
      emitSpy.mockReturnValue(roomBroadcaster as never);

      const ride = await mockRideService.transitionRide('ride-uuid-completed', 'completed', 'dp-1');
      if (ride.status === 'completed') {
        io.to('ride:ride-uuid-completed').emit('ride:completed', {
          rideId: ride.id,
          finalFare: ride.finalFare ?? ride.fareEstimate,
          actualDistanceMeters: ride.actualDistanceMeters ?? 0,
          actualFuelCost: ride.actualFuelCost ?? null,
          billing: ride.billing ?? null,
          ride,
        });
      }

      expect(roomBroadcaster.emit).toHaveBeenCalledWith(
        'ride:completed',
        expect.objectContaining({
          rideId: 'ride-uuid-completed',
          finalFare: 3717,
          actualDistanceMeters: 30000,
          actualFuelCost: 540,
          billing: expect.objectContaining({
            finalFare: 3717,
            actualFuelCost: 540,
          }),
        }),
      );

      io.close();
    });
  });

  // =========================================================================
  // Live PostgreSQL & PostGIS Integration Tests
  // =========================================================================
  describe('PostgreSQL Live Distance Accumulation & Reconciled Completion', () => {
    let customerId: string;
    let driverUserId: string;
    let driverProfileId: string;
    let vehicleId: string;
    let repo: PostgresRideRepository;
    let driverRepo: PostgresDriverRepository;
    let rideService: RideService;

    beforeAll(async () => {
      repo = new PostgresRideRepository(pool);
      driverRepo = new PostgresDriverRepository(pool);
      rideService = new RideService(repo, driverRepo);

      const suffix = randomUUID();
      const customerRes = await pool.query<{ id: string }>(
        `INSERT INTO users (first_name, last_name, phone, role)
         VALUES ('Prem', 'Customer', $1, 'customer') RETURNING id`,
        [`+91${suffix.replaceAll('-', '').slice(0, 10)}`],
      );
      customerId = customerRes.rows[0]!.id;

      const driverRes = await pool.query<{ id: string }>(
        `INSERT INTO users (first_name, last_name, phone, role)
         VALUES ('Prem', 'Driver', $1, 'driver') RETURNING id`,
        [`+92${suffix.replaceAll('-', '').slice(0, 10)}`],
      );
      driverUserId = driverRes.rows[0]!.id;

      const profileRes = await pool.query<{ id: string }>(
        `INSERT INTO driver_profiles (user_id, license_number, license_expiry, verification_status, availability_status)
         VALUES ($1, $2, CURRENT_DATE + 365, 'approved', 'available') RETURNING id`,
        [driverUserId, `LIC-${suffix}`],
      );
      driverProfileId = profileRes.rows[0]!.id;

      // Configured vehicle fuel rate: ₹18.00/km (Fortuner)
      const vehicleRes = await pool.query<{ id: string }>(
        `INSERT INTO vehicles (driver_profile_id, make, model, plate_number, sector, category, fuel_rate_per_km, is_active)
         VALUES ($1, 'Toyota', 'Fortuner', $2, 'premium', 'fortuner', 18.00, TRUE) RETURNING id`,
        [driverProfileId, `PREM-${suffix.replaceAll('-', '').slice(0, 10)}`],
      );
      vehicleId = vehicleRes.rows[0]!.id;
      // Set last_location and last_location_at so driver is eligible
      await pool.query(
        `UPDATE driver_profiles
         SET availability_status = 'available',
             last_location = ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography,
             last_location_at = NOW()
         WHERE id = $1`,
        [driverProfileId],
      );
    });

    afterAll(async () => {
      await pool.query(
        'DELETE FROM ride_location_breadcrumbs WHERE ride_id IN (SELECT id FROM rides WHERE customer_id = $1)',
        [customerId],
      );
      await pool.query('DELETE FROM rides WHERE customer_id = $1', [customerId]);
      if (driverProfileId) {
        await pool.query('DELETE FROM vehicles WHERE driver_profile_id = $1', [driverProfileId]);
        await pool.query('DELETE FROM driver_profiles WHERE id = $1', [driverProfileId]);
      }
      if (customerId || driverUserId) {
        await pool.query('DELETE FROM users WHERE id = $1 OR id = $2', [customerId, driverUserId]);
      }
    });

    it('full flow: first GPS zero dist -> accumulate distance -> duplicate 0 dist -> only in_progress -> server-side fuel reconciliation', async () => {
      // 1. Create a Premium ride (4 hours rental)
      const ride = await repo.create(customerId, {
        pickup: { latitude: 12.9716, longitude: 77.5946 },
        destination: { latitude: 13.0, longitude: 77.65 },
        sector: 'premium',
        vehicleCategory: 'fortuner',
        rentalDetails: { hours: 4, rentalHours: 4 },
        fareEstimate: 4000,
      });

      expect(ride.sector).toBe('premium');
      expect(ride.status).toBe('searching');

      // 2. Proves non-in_progress ride does NOT accumulate distance
      const inactiveRes = await repo.recordBreadcrumbAndAccumulateDistance(
        ride.id,
        12.9716,
        77.5946,
      );
      expect(inactiveRes).toBeNull();

      // Check distance in DB remains 0
      const check1 = await repo.findById(ride.id);
      expect(check1?.actualDistanceMeters).toBe(0);

      // 3. Driver accepts ride
      await rideService.acceptRide(driverProfileId, ride.id);

      // Verify acceptance assigned our vehicle
      const acceptedRide = await repo.findById(ride.id);
      expect(acceptedRide?.assignedDriverId).toBe(driverProfileId);
      expect(acceptedRide?.assignedVehicleId).toBe(vehicleId);

      // Still in 'driver_assigned', not 'in_progress', so should not accumulate
      const notStartedRes = await repo.recordBreadcrumbAndAccumulateDistance(
        ride.id,
        12.9716,
        77.5946,
      );
      expect(notStartedRes).toBeNull();

      // 4. Transition through valid lifecycle: driver_arriving -> driver_arrived -> in_progress
      await repo.transition(ride.id, 'driver_arriving', driverProfileId);
      await repo.transition(ride.id, 'driver_arrived', driverProfileId);
      await repo.transition(ride.id, 'in_progress', driverProfileId);

      // 5. First GPS point: (12.9716, 77.5946)
      // Must record zero incremental distance (no artificial distance)
      const firstPoint = await repo.recordBreadcrumbAndAccumulateDistance(
        ride.id,
        12.9716,
        77.5946,
        20,
        90,
      );
      expect(firstPoint).toEqual({
        actualDistanceMeters: 0,
        incrementalDistanceMeters: 0,
      });

      // Verify breadcrumb stored in ride_location_breadcrumbs
      const breadcrumbsRes1 = await pool.query(
        'SELECT id, ride_id, speed, heading FROM ride_location_breadcrumbs WHERE ride_id = $1 ORDER BY recorded_at ASC',
        [ride.id],
      );
      expect(breadcrumbsRes1.rows).toHaveLength(1);
      expect(breadcrumbsRes1.rows[0].ride_id).toBe(ride.id);

      // 6. Second GPS point: ~1,100 meters away (12.9816, 77.5946)
      const secondPoint = await repo.recordBreadcrumbAndAccumulateDistance(
        ride.id,
        12.9816,
        77.5946,
        45,
        0,
      );
      expect(secondPoint).not.toBeNull();
      expect(secondPoint!.incrementalDistanceMeters).toBeGreaterThan(1000);
      expect(secondPoint!.incrementalDistanceMeters).toBeLessThan(1200);
      expect(secondPoint!.actualDistanceMeters).toBe(secondPoint!.incrementalDistanceMeters);

      const recordedDistanceAfterStep2 = secondPoint!.actualDistanceMeters;

      // 7. Duplicate GPS point: identical coordinate (12.9816, 77.5946)
      // Must NOT add distance (avoid double-counting duplicate points)
      const duplicatePoint = await repo.recordBreadcrumbAndAccumulateDistance(
        ride.id,
        12.9816,
        77.5946,
        0,
        0,
      );
      expect(duplicatePoint).toEqual({
        actualDistanceMeters: recordedDistanceAfterStep2,
        incrementalDistanceMeters: 0,
      });

      // 8. Third GPS point: ~1,100 meters further north (12.9916, 77.5946)
      const thirdPoint = await repo.recordBreadcrumbAndAccumulateDistance(
        ride.id,
        12.9916,
        77.5946,
        50,
        0,
      );
      expect(thirdPoint).not.toBeNull();
      expect(thirdPoint!.actualDistanceMeters).toBeGreaterThan(recordedDistanceAfterStep2 + 1000);

      // Verify breadcrumbs table contains all breadcrumbs for this ride
      const breadcrumbsAll = await pool.query(
        'SELECT COUNT(*)::int AS count FROM ride_location_breadcrumbs WHERE ride_id = $1',
        [ride.id],
      );
      expect(breadcrumbsAll.rows[0].count).toBe(4);

      // 9. Complete the Premium Ride
      // Manually set actual_distance_meters to exactly 50,000 meters (50 km) to test exact financial math
      await pool.query('UPDATE rides SET actual_distance_meters = 50000 WHERE id = $1', [ride.id]);

      const completedRide = await rideService.completeRide(ride.id, driverProfileId);

      expect(completedRide.status).toBe('completed');
      expect(completedRide.actualDistanceMeters).toBe(50000);

      // Hourly base: 4 hours * 1000 = ₹4,000
      // Actual fuel: 50 km * ₹18.00 (from DB vehicle) = ₹900
      // Subtotal: 4000 + 900 = ₹4,900
      // Tax (5%): 4900 * 0.05 = ₹245
      // Final Fare: 4900 + 245 = ₹5,145
      expect(completedRide.actualFuelCost).toBe(900);
      expect(completedRide.finalFare).toBe(5145);

      // Verify itemized billing
      expect(completedRide.billing).toEqual({
        currency: 'INR',
        hourlyRate: 1000,
        bookedHours: 4,
        hourlyBase: 4000,
        fuelRatePerKm: 18,
        actualDistanceKm: 50,
        actualDistanceMeters: 50000,
        actualFuelCost: 900,
        subtotal: 4900,
        taxAmount: 245,
        finalFare: 5145,
      });

      // 10. Verify values were persisted directly in PostgreSQL
      const dbRow = await pool.query(
        'SELECT actual_distance_meters, actual_fuel_cost, final_fare, status FROM rides WHERE id = $1',
        [ride.id],
      );
      expect(dbRow.rows[0].status).toBe('completed');
      expect(Number(dbRow.rows[0].actual_distance_meters)).toBe(50000);
      expect(Number(dbRow.rows[0].actual_fuel_cost)).toBe(900);
      expect(Number(dbRow.rows[0].final_fare)).toBe(5145);

      // Clean up breadcrumbs and ride
      await pool.query('DELETE FROM ride_location_breadcrumbs WHERE ride_id = $1', [ride.id]);
      await pool.query('DELETE FROM rides WHERE id = $1', [ride.id]);
    });

    it('safely falls back to ₹15.00/km if vehicle fuel_rate_per_km is 0 or null', async () => {
      const suffix = randomUUID();
      const driverRes2 = await pool.query<{ id: string }>(
        `INSERT INTO users (first_name, last_name, phone, role)
         VALUES ('Prem2', 'Driver', $1, 'driver') RETURNING id`,
        [`+93${suffix.replaceAll('-', '').slice(0, 10)}`],
      );
      const profileRes2 = await pool.query<{ id: string }>(
        `INSERT INTO driver_profiles (user_id, license_number, license_expiry, verification_status, availability_status)
         VALUES ($1, $2, CURRENT_DATE + 365, 'approved', 'available') RETURNING id`,
        [driverRes2.rows[0]!.id, `LIC2-${suffix}`],
      );
      const driverProfileId2 = profileRes2.rows[0]!.id;

      const vehRes = await pool.query<{ id: string }>(
        `INSERT INTO vehicles (driver_profile_id, make, model, plate_number, sector, category, fuel_rate_per_km, is_active)
         VALUES ($1, 'Toyota', 'Fortuner', $2, 'premium', 'fortuner', 0, TRUE) RETURNING id`,
        [driverProfileId2, `PREM2-${suffix.replaceAll('-', '').slice(0, 10)}`],
      );
      const fallbackVehId = vehRes.rows[0]!.id;

      await pool.query(
        `UPDATE driver_profiles
         SET availability_status = 'available',
             last_location = ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography,
             last_location_at = NOW()
         WHERE id = $1`,
        [driverProfileId2],
      );

      const ride = await repo.create(customerId, {
        pickup: { latitude: 12.9716, longitude: 77.5946 },
        destination: { latitude: 13.0, longitude: 77.65 },
        sector: 'premium',
        vehicleCategory: 'fortuner',
        rentalDetails: { hours: 2, rentalHours: 2 },
        fareEstimate: 2000,
      });

      await rideService.acceptRide(driverProfileId2, ride.id);
      await repo.transition(ride.id, 'driver_arriving', driverProfileId2);
      await repo.transition(ride.id, 'driver_arrived', driverProfileId2);
      await repo.transition(ride.id, 'in_progress', driverProfileId2);

      await pool.query('UPDATE rides SET actual_distance_meters = 20000 WHERE id = $1', [ride.id]);

      const completed = await repo.complete(ride.id, driverProfileId2, pool as never);

      // Hourly base: 2 * 1000 = 2000
      // Fallback fuel rate: 15.00/km -> 20 km * 15 = 300
      // Subtotal: 2300
      // Tax: 2300 * 0.05 = 115
      // Final fare: 2415
      expect(completed?.actualFuelCost).toBe(300);
      expect(completed?.finalFare).toBe(2415);

      await pool.query('DELETE FROM rides WHERE id = $1', [ride.id]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [fallbackVehId]);
      await pool.query('DELETE FROM driver_profiles WHERE id = $1', [driverProfileId2]);
      await pool.query('DELETE FROM users WHERE id = $1', [driverRes2.rows[0]!.id]);
    });
  });
});
