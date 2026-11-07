import { describe, expect, it, vi } from 'vitest';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import { FareController } from '../controllers/fare.controller.js';
import { createRideSchema, fareEstimateSchema } from '../../rides/schemas/ride.schemas.js';
import { PostgresDriverRepository } from '../../rides/repositories/driver.repository.js';
import type { FarePricingConfig } from '../types/fare.js';

describe('Phase 4 Step 5: Service Vehicle Trip-Based Refactoring', () => {
  const pricing: FarePricingConfig = {
    baseFare: 5000,
    distanceRatePerKm: 1500,
    timeRatePerMinute: 200,
    currency: 'INR',
    pricingVersion: 'v1-step5-test',
  };

  const calculator = new FareCalculatorService(pricing);

  describe('Service fixed-fare contract', () => {
    const configured = (code: string, fare = 123.45) => ({
      id: '7d7c2be0-21bd-4a75-907a-8b558079ef17',
      name: code,
      code,
      sector: 'service' as const,
      baseFare: null,
      perKmRate: null,
      serviceFixedFare: fare,
      serviceRadiusMeters: 25000,
      currency: 'INR' as const,
      active: true,
      version: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const category of [
      'ambulance',
      'towing',
      'roadside_assist',
      'jcb',
      'crane',
      'road_roller',
      'fire_truck',
    ]) {
      it(`${category} charges only its configured fixed fare for short and long service trips`, () => {
        for (const distanceMeters of [0, 1000, 25000, 100000]) {
          const result = calculator.calculateEstimate(
            {
              distanceMeters,
              durationSeconds: 9000,
              sector: 'service',
              vehicleCategory: category,
              waitingMinutes: 90,
              rentalHours: 12,
              fuelRatePerKm: 999,
            },
            configured(category),
          );
          expect(result).toMatchObject({
            bookable: true,
            bookingFare: {
              baseAmount: 12345,
              distanceAmount: 0,
              timeAmount: 0,
              grossAmount: 12300,
              pricingVersion: 'vehicle-type:7d7c2be0-21bd-4a75-907a-8b558079ef17:v3',
              vehicleConfiguration: {
                pricingModel: 'service_fixed',
                serviceRadiusMeters: 25000,
                perKmRatePaise: 0,
              },
            },
          });
          if (!('bookingFare' in result)) throw Error('Expected fixed fare');
          expect(result.bookingFare?.taxAmount).toBeUndefined();
          expect(result.bookingFare?.fuelAmount).toBeUndefined();
        }
      });
      it(`${category} cannot use a legacy distance tariff`, () => {
        expect(() =>
          calculator.calculate({
            distanceMeters: 10000,
            durationSeconds: 600,
            sector: 'service',
            vehicleCategory: category,
          }),
        ).toThrow(/active fixed fare/);
      });
    }
    it('allows an explicitly configured zero fare and fails closed for disabled, missing or mixed configurations', () => {
      const input = {
        distanceMeters: 10000,
        durationSeconds: 600,
        sector: 'service' as const,
        vehicleCategory: 'ambulance',
      };
      expect(calculator.calculateEstimate(input, configured('ambulance', 0))).toMatchObject({
        bookingFare: { grossAmount: 0 },
      });
      for (const changes of [
        { active: false },
        { serviceFixedFare: null },
        { serviceFixedFare: -1 },
        { baseFare: 1 },
        { perKmRate: 1 },
        { serviceRadiusMeters: 0 },
        { serviceRadiusMeters: 200001 },
      ])
        expect(() =>
          calculator.calculateEstimate(input, { ...configured('ambulance'), ...changes }),
        ).toThrow();
    });
  });

  describe('3. Backend Schema & Types Validation', () => {
    const validPickup = { latitude: 12.9716, longitude: 77.5946 };
    const validDestination = { latitude: 12.9352, longitude: 77.6245 };

    it('createRideSchema accepts service details without workHours', () => {
      const payload = {
        pickup: validPickup,
        destination: validDestination,
        sector: 'service',
        clientRequestId: '165938c9-c46c-43dd-b8da-144dbad559f4',
        vehicleCategory: 'jcb',
        serviceDetails: {
          serviceType: 'jcb',
          emergencyLevel: 'normal',
          description: 'Foundation digging at site',
          notes: 'Near south gate',
        },
      };

      const parsed = createRideSchema.parse(payload);
      expect(parsed.sector).toBe('service');
      expect(parsed.vehicleCategory).toBe('jcb');
      expect(parsed.serviceDetails?.serviceType).toBe('jcb');
      expect(parsed.serviceDetails?.description).toBe('Foundation digging at site');
      expect((parsed.serviceDetails as Record<string, unknown>).workHours).toBeUndefined();
    });

    it('createRideSchema accepts recovery and roadside service categories', () => {
      const payload = {
        pickup: validPickup,
        destination: validDestination,
        sector: 'service',
        clientRequestId: '165938c9-c46c-43dd-b8da-144dbad559f4',
        vehicleCategory: 'recovery_vehicle',
        serviceDetails: {
          serviceType: 'recovery_vehicle',
          emergencyLevel: 'high',
          description: 'Vehicle rolled into ditch',
        },
      };

      const parsed = createRideSchema.parse(payload);
      expect(parsed.serviceDetails?.serviceType).toBe('recovery_vehicle');
    });

    it('fareEstimateSchema strips workHours from serviceDetails', () => {
      const payload = {
        pickup: validPickup,
        destination: validDestination,
        sector: 'service',
        vehicleCategory: 'jcb',
        serviceDetails: {
          serviceType: 'jcb',
          workHours: 4,
          description: 'Earth excavation',
        },
      };

      const parsed = fareEstimateSchema.parse(payload);
      expect((parsed.serviceDetails as Record<string, unknown>).workHours).toBeUndefined();
      expect(parsed.serviceDetails?.description).toBe('Earth excavation');
    });

    it('preserves rentalDetails for premium sector in schemas', () => {
      const payload = {
        pickup: validPickup,
        destination: validDestination,
        sector: 'premium',
        vehicleCategory: 'fortuner',
        rentalHours: 4,
        fuelRatePerKm: 18,
        rentalDetails: {
          hours: 4,
          fuelRatePerKm: 18,
        },
      };

      const parsed = fareEstimateSchema.parse(payload);
      expect(parsed.sector).toBe('premium');
      expect(parsed.rentalHours).toBe(4);
      expect(parsed.rentalDetails?.hours).toBe(4);
    });
  });

  describe('4. FareController Protection Against Service Hourly Manipulation', () => {
    it('FareController does not forward rentalHours or fuelRatePerKm for service sector', async () => {
      const estimateMock = vi.fn().mockResolvedValue({
        distanceMeters: 10000,
        durationSeconds: 1200,
        baseAmount: 120000,
        distanceAmount: 40000,
        timeAmount: 4000,
        grossAmount: 172200,
        currency: 'INR',
        pricingVersion: 'v1',
      });

      const fakeService = { estimate: estimateMock } as never;
      const controller = new FareController(fakeService);

      const req = {
        body: {
          pickup: { latitude: 12.9716, longitude: 77.5946 },
          destination: { latitude: 12.9352, longitude: 77.6245 },
          sector: 'service',
          vehicleCategory: 'jcb',
          rentalHours: 12, // Attempt to inject rental hours
          rentalDetails: { hours: 12, fuelRatePerKm: 25 },
          serviceDetails: {
            serviceType: 'jcb',
            description: 'Site excavation',
          },
        },
      };

      const jsonMock = vi.fn();
      const res = { json: jsonMock } as never;
      const next = vi.fn();

      await controller.estimate(req as never, res, next);

      expect(estimateMock).toHaveBeenCalledTimes(1);
      const optionsPassed = estimateMock.mock.calls[0]![2];

      expect(optionsPassed.sector).toBe('service');
      expect(optionsPassed.vehicleCategory).toBe('jcb');
      expect(optionsPassed.rentalHours).toBeUndefined();
      expect(optionsPassed.fuelRatePerKm).toBeUndefined();
    });

    it('FareController preserves rentalHours and fuelRatePerKm for premium sector', async () => {
      const estimateMock = vi.fn().mockResolvedValue({
        distanceMeters: 50000,
        durationSeconds: 7200,
        baseAmount: 400000,
        distanceAmount: 0,
        timeAmount: 0,
        fuelAmount: 90000,
        grossAmount: 514500,
        currency: 'INR',
        pricingVersion: 'v1',
      });

      const fakeService = { estimate: estimateMock } as never;
      const controller = new FareController(fakeService);

      const req = {
        body: {
          pickup: { latitude: 12.9716, longitude: 77.5946 },
          destination: { latitude: 12.9352, longitude: 77.6245 },
          sector: 'premium',
          vehicleCategory: 'fortuner',
          rentalHours: 4,
          rentalDetails: { hours: 4, fuelRatePerKm: 18 },
        },
      };

      const jsonMock = vi.fn();
      const res = { json: jsonMock } as never;
      const next = vi.fn();

      await controller.estimate(req as never, res, next);

      expect(estimateMock).toHaveBeenCalledTimes(1);
      const optionsPassed = estimateMock.mock.calls[0]![2];

      expect(optionsPassed.sector).toBe('premium');
      expect(optionsPassed.rentalHours).toBe(4);
      expect(optionsPassed.fuelRatePerKm).toBe(18);
    });
  });

  describe('5. Service Vehicle Matching Sector & Category Constraints', () => {
    it('queries database with sector=service and matching vehicleCategory', async () => {
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          {
            driverProfileId: 'dp-service-jcb-1',
            userId: 'user-jcb-1',
            vehicleId: 'veh-jcb-1',
            distanceMeters: 1200,
            latitude: 12.97,
            longitude: 77.59,
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
        12.9716,
        77.5946,
        2000,
        10,
        new Date(),
        'service',
        'jcb',
      );

      expect(queryMock).toHaveBeenCalledTimes(1);
      const sql = queryMock.mock.calls[0]![0];
      const params = queryMock.mock.calls[0]![1];

      // Verifies SQL filters by sector and vehicle category
      expect(sql).toContain('v.sector = $6');
      expect(sql).toContain('v.category = $7');
      expect(params[5]).toBe('service');
      expect(params[6]).toBe('jcb');
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.sector).toBe('service');
      expect(candidates[0]!.vehicleCategory).toBe('jcb');
    });
  });

  describe('6. Passenger and Logistics Fares Stability', () => {
    it('preserves passenger calculation without alterations', () => {
      const result = calculator.calculate({
        distanceMeters: 10000,
        durationSeconds: 1200,
        sector: 'passenger',
        vehicleCategory: 'sedan',
        waitingMinutes: 8,
      });

      expect(result.baseAmount).toBe(6250);
      expect(result.distanceAmount).toBe(37500);
      expect(result.timeAmount).toBe(4000);
      expect(result.waitingAmount).toBe(1000);
      expect(result.grossAmount).toBe(48800);
      expect(result.taxAmount).toBeUndefined();
    });

    it('preserves logistics calculation without alterations', () => {
      const result = calculator.calculate({
        distanceMeters: 15000,
        durationSeconds: 1800,
        sector: 'logistics',
        vehicleCategory: 'mini_truck',
        weightKg: 45,
        hasLoadingAssistance: true,
      });

      expect(result.baseAmount).toBe(12500);
      expect(result.distanceAmount).toBe(81000);
      expect(result.timeAmount).toBe(6000);
      expect(result.weightAmount).toBe(12500);
      expect(result.loadingAmount).toBe(15000);
      expect(result.taxAmount).toBe(6350);
      expect(result.grossAmount).toBe(133400);
    });
  });
});
