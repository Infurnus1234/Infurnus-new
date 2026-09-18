import { describe, expect, it, vi } from 'vitest';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import { PostgresDriverRepository } from '../repositories/driver.repository.js';
import { PostgresRideRepository } from '../repositories/ride.repository.js';
import { RideService } from '../services/ride.service.js';
import { MatchingService } from '../services/matching.service.js';
import { createRideSchema, fareEstimateSchema } from '../schemas/ride.schemas.js';
import type { FarePricingConfig } from '../../fares/types/fare.js';

describe('Phase 4 Step 6: Logistics Cargo Delivery Enhancements', () => {
  const pricing: FarePricingConfig = {
    baseFare: 5000,
    distanceRatePerKm: 1500,
    timeRatePerMinute: 200,
    currency: 'INR',
    pricingVersion: 'v1-step6-logistics',
  };

  const calculator = new FareCalculatorService(pricing);

  describe('1. Logistics Goods Schema & Data Survival', () => {
    const validPickup = { latitude: 12.9716, longitude: 77.5946 };
    const validDestination = { latitude: 12.9352, longitude: 77.6245 };

    it('createRideSchema preserves cargo category, description, weight, quantity, and helper info', () => {
      const payload = {
        pickup: validPickup,
        destination: validDestination,
        pickupAddress: 'Warehouse 4, Indiranagar',
        destinationAddress: 'Tech Park, Electronic City',
        sector: 'logistics' as const,
        vehicleCategory: 'mini_truck',
        goods: {
          category: 'Electronics & Gadgets',
          itemType: 'Electronics & Gadgets',
          description: '10 Boxes of 32-inch LED Monitors',
          weightKg: 48,
          quantity: 10,
          hasLoadingAssistance: true,
          loadingAssistance: true,
        },
      };

      const parsed = createRideSchema.parse(payload);
      expect(parsed.sector).toBe('logistics');
      expect(parsed.vehicleCategory).toBe('mini_truck');
      expect(parsed.goods).toBeDefined();
      expect(parsed.goods?.category).toBe('Electronics & Gadgets');
      expect(parsed.goods?.itemType).toBe('Electronics & Gadgets');
      expect(parsed.goods?.description).toBe('10 Boxes of 32-inch LED Monitors');
      expect(parsed.goods?.weightKg).toBe(48);
      expect(parsed.goods?.quantity).toBe(10);
      expect(parsed.goods?.hasLoadingAssistance).toBe(true);
      expect(parsed.goods?.loadingAssistance).toBe(true);
    });

    it('fareEstimateSchema parses logistics cargo fields with description and loading assistance', () => {
      const payload = {
        pickup: validPickup,
        destination: validDestination,
        sector: 'logistics' as const,
        vehicleCategory: 'mini_truck',
        weightKg: 45,
        hasLoadingAssistance: true,
        goods: {
          category: 'Machinery & Spares',
          description: 'Heavy industrial gearbox',
          weightKg: 45,
          quantity: 1,
          loadingAssistance: true,
        },
      };

      const parsed = fareEstimateSchema.parse(payload);
      expect(parsed.sector).toBe('logistics');
      expect(parsed.goods?.category).toBe('Machinery & Spares');
      expect(parsed.goods?.description).toBe('Heavy industrial gearbox');
      expect(parsed.goods?.weightKg).toBe(45);
      expect(parsed.goods?.quantity).toBe(1);
      expect(parsed.goods?.loadingAssistance).toBe(true);
    });

    it('PostgresRideRepository maps and normalizes complete cargo details for drivers', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'ride-logistics-123',
            customerId: 'cust-1',
            assignedDriverId: null,
            assignedVehicleId: null,
            pickupLatitude: 12.9716,
            pickupLongitude: 77.5946,
            destinationLatitude: 12.9352,
            destinationLongitude: 77.6245,
            pickupAddress: 'Warehouse 4, Indiranagar',
            destinationAddress: 'Tech Park, Electronic City',
            status: 'searching',
            fareEstimate: 85000,
            finalFare: null,
            actualDistanceMeters: 0,
            actualFuelCost: null,
            sector: 'logistics',
            vehicleCategory: 'mini_truck',
            goods: {
              category: 'Furniture & Home',
              description: 'Wooden dining table with 4 chairs',
              weightKg: 65,
              quantity: 5,
              hasLoadingAssistance: true,
            },
            serviceDetails: null,
            rentalDetails: null,
            pin: '5678',
            pinVerified: false,
            driverName: null,
            driverPhone: null,
            driverPhotoUrl: null,
            driverRating: null,
            vehicleMake: null,
            vehicleModel: null,
            vehicleColor: null,
            vehiclePlateNumber: null,
            cancellationReason: null,
            cancelledAt: null,
            completedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const repo = new PostgresRideRepository({ query: mockQuery } as never);
      const ride = await repo.findById('ride-logistics-123');

      expect(ride).not.toBeNull();
      expect(ride?.sector).toBe('logistics');
      expect(ride?.vehicleCategory).toBe('mini_truck');
      expect(ride?.goods).toBeDefined();
      expect(ride?.goods?.['category']).toBe('Furniture & Home');
      expect(ride?.goods?.['itemType']).toBe('Furniture & Home');
      expect(ride?.goods?.['description']).toBe('Wooden dining table with 4 chairs');
      expect(ride?.goods?.['weightKg']).toBe(65);
      expect(ride?.goods?.['quantity']).toBe(5);
      expect(ride?.goods?.['hasLoadingAssistance']).toBe(true);
      expect(ride?.goods?.['loadingAssistance']).toBe(true);
    });
  });

  describe('2. Server-Side Logistics Fare Calculation (Weight & Loading Surcharges)', () => {
    it('calculates logistics fare with server-side weight surcharge and loading assistance charge', () => {
      // 15 km, 30 min duration, mini_truck
      const result = calculator.calculate({
        distanceMeters: 15000,
        durationSeconds: 1800,
        sector: 'logistics',
        vehicleCategory: 'mini_truck',
        weightKg: 45, // 25 kg excess over 20 kg threshold @ ₹5/kg = 12,500 paise
        hasLoadingAssistance: true, // 15,000 paise (₹150)
      });

      // Mini Truck multiplier:
      // Base: 5,000 * 2.5 = 12,500 paise
      // Distance: (15,000 * 1,500 / 1,000) * 1.8 = 40,500 paise
      // Time: (1,800 * 200 / 60) = 6,000 paise
      // Weight surcharge: (45 - 20) * 500 = 12,500 paise
      // Loading helper: 15,000 paise
      // Subtotal: 12,500 + 40,500 + 6,000 + 12,500 + 15,000 = 86,500 paise
      // Tax (5% GST): 86,500 * 0.05 = 4,325 paise
      // Gross: 86,500 + 4,325 = 90,825 paise
      expect(result.baseAmount).toBe(12500);
      expect(result.distanceAmount).toBe(40500);
      expect(result.timeAmount).toBe(6000);
      expect(result.weightAmount).toBe(12500);
      expect(result.loadingAmount).toBe(15000);
      expect(result.taxAmount).toBe(4325);
      expect(result.grossAmount).toBe(90825);
    });

    it('does not apply weight surcharge if weight is within free threshold (<= 20kg)', () => {
      const result = calculator.calculate({
        distanceMeters: 10000,
        durationSeconds: 1200,
        sector: 'logistics',
        vehicleCategory: 'mini_truck',
        weightKg: 18,
        hasLoadingAssistance: false,
      });

      expect(result.weightAmount).toBeUndefined();
      expect(result.loadingAmount).toBeUndefined();
    });

    it('does not apply loading assistance charge when helper is not requested', () => {
      const result = calculator.calculate({
        distanceMeters: 10000,
        durationSeconds: 1200,
        sector: 'logistics',
        vehicleCategory: 'mini_truck',
        weightKg: 30, // 10kg excess @ ₹5/kg = 5000 paise
        hasLoadingAssistance: false,
      });

      expect(result.weightAmount).toBe(5000);
      expect(result.loadingAmount).toBeUndefined();
    });
  });

  describe('3. Logistics Driver Matching & Vehicle Category Isolation', () => {
    it('only returns logistics-compatible vehicles when searching for logistics ride drivers', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [
          {
            driverProfileId: 'dp-logistics-1',
            userId: 'user-logistics-1',
            vehicleId: 'veh-mini-truck-1',
            distanceMeters: 450,
            latitude: 12.971,
            longitude: 77.594,
            availabilityStatus: 'available',
            verificationStatus: 'approved',
            locationRecordedAt: new Date(),
            activeRideCount: 0,
            sector: 'logistics',
            vehicleCategory: 'mini_truck',
          },
        ],
      });

      const repo = new PostgresDriverRepository({ query: mockQuery } as never);
      const candidates = await repo.findNearbyEligible(
        12.9716,
        77.5946,
        5000,
        10,
        new Date(),
        'logistics',
        'mini_truck',
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const params = mockQuery.mock.calls[0]![1];
      expect(params[5]).toBe('logistics');
      expect(params[6]).toBe('mini_truck');
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.sector).toBe('logistics');
      expect(candidates[0]!.vehicleCategory).toBe('mini_truck');
    });

    it('MatchingService delegates sector and category to driver repository for logistics dispatch', async () => {
      const findNearbyMock = vi.fn().mockResolvedValue([
        {
          driverProfileId: 'dp-logistics-2',
          userId: 'user-logistics-2',
          vehicleId: 'veh-mini-truck-2',
          distanceMeters: 300,
          sector: 'logistics',
          vehicleCategory: 'mini_truck',
        },
      ]);

      const matching = new MatchingService({ findNearbyEligible: findNearbyMock } as never);
      const best = await matching.findBestDriver(
        { latitude: 12.9716, longitude: 77.5946 },
        'logistics',
        'mini_truck',
      );

      expect(findNearbyMock).toHaveBeenCalledWith(
        12.9716,
        77.5946,
        expect.any(Number),
        expect.any(Number),
        expect.any(Date),
        'logistics',
        'mini_truck',
      );
      expect(best?.sector).toBe('logistics');
      expect(best?.vehicleCategory).toBe('mini_truck');
    });

    it('wrong-sector driver (passenger sedan) cannot accept a logistics ride', async () => {
      // In PostgresRideRepository.accept:
      // AND v.sector = r.sector AND (r.vehicle_category IS NULL OR v.category = r.vehicle_category)
      // If driver vehicle is passenger sedan, query returns 0 rows updated
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [], // 0 rows updated due to sector mismatch
      });

      const rideRepo = new PostgresRideRepository({ query: mockQuery } as never);
      const accepted = await rideRepo.accept('ride-logistics-1', 'dp-passenger-sedan');

      expect(accepted).toBeNull();
    });

    it('RideService rejects acceptance when driver is incompatible with logistics ride', async () => {
      const mockRepo = {
        accept: vi.fn().mockResolvedValue(null),
      };

      const rideService = new RideService(mockRepo as never);

      await expect(
        rideService.acceptRide('dp-passenger-sedan', 'ride-logistics-1'),
      ).rejects.toThrow('Ride is no longer available');
    });
  });

  describe('4. Passenger, Service, and Premium Stability Verification', () => {
    it('preserves passenger fare without goods or surcharges', () => {
      const result = calculator.calculate({
        distanceMeters: 10000,
        durationSeconds: 1200,
        sector: 'passenger',
        vehicleCategory: 'sedan',
        waitingMinutes: 5,
      });

      expect(result.baseAmount).toBe(6250);
      expect(result.distanceAmount).toBe(18750);
      expect(result.timeAmount).toBe(4000);
      expect(result.waitingAmount).toBe(400); // 2 min billable @ ₹2/min = 400 paise
      expect(result.grossAmount).toBe(29400);
      expect(result.weightAmount).toBeUndefined();
      expect(result.loadingAmount).toBeUndefined();
    });

    it('preserves service vehicle trip-based fare (JCB mobilization + distance)', () => {
      const result = calculator.calculate({
        distanceMeters: 10000,
        durationSeconds: 1800,
        sector: 'service',
        vehicleCategory: 'jcb',
      });

      expect(result.baseAmount).toBe(120000);
      expect(result.distanceAmount).toBe(40000);
      expect(result.grossAmount).toBe(174300);
    });

    it('preserves premium vehicle hourly package + fuel rate', () => {
      const result = calculator.calculate({
        distanceMeters: 50000,
        durationSeconds: 14400,
        sector: 'premium',
        vehicleCategory: 'fortuner',
        rentalHours: 4,
        fuelRatePerKm: 1800,
      });

      expect(result.baseAmount).toBe(400000);
      expect(result.fuelAmount).toBe(90000);
      expect(result.grossAmount).toBe(514500);
    });
  });
});
