import { describe, expect, it } from 'vitest';
import { fareEstimateSchema } from '../../rides/schemas/ride.schemas.js';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import {
  calculateHaversineDistanceMeters,
  FareEstimateService,
} from '../services/fare-estimate.service.js';
import type { Coordinates, MapProvider } from '../../rides/providers/map.provider.js';

describe('BUG-P3-01 & BUG-P3-03 & BUG-P3-05: Fare Estimate Parity & Contract Tests', () => {
  const pricingConfig = {
    baseFare: 5000,
    distanceRatePerKm: 1500,
    timeRatePerMinute: 200,
    currency: 'INR' as const,
    pricingVersion: 'v1-contract-test',
  };
  const calculator = new FareCalculatorService(pricingConfig);

  // Mock map provider simulating Google Maps
  const mockMapProvider: MapProvider = {
    calculateRoute: async (origin: Coordinates, destination: Coordinates) => {
      // Simulate 10km, 15 minutes road route
      return {
        distanceMeters: 10000,
        durationSeconds: 900,
        encodedPolyline: 'mock_polyline',
      };
    },
    calculateMatrix: async () => [],
    geocode: async () => null,
    places: async () => [],
  };

  // Mock map provider simulating Google Maps failure / null
  const nullMapProvider: MapProvider = {
    calculateRoute: async () => null,
    calculateMatrix: async () => [],
    geocode: async () => null,
    places: async () => [],
  };

  describe('BUG-P3-01: Flutter-Equivalent Contract Payload Validation', () => {
    it('accepts Passenger payload with vehicleCategory and waitingMinutes', () => {
      const flutterPayload = {
        pickup: { latitude: 12.9716, longitude: 77.5946 },
        destination: { latitude: 12.9352, longitude: 77.6245 },
        sector: 'passenger',
        vehicleCategory: 'sedan',
        waitingMinutes: 5,
      };

      const parsed = fareEstimateSchema.parse(flutterPayload);
      expect(parsed.sector).toBe('passenger');
      expect(parsed.vehicleCategory).toBe('sedan');
      expect(parsed.waitingMinutes).toBe(5);
    });

    it('accepts Logistics payload with weightKg and hasLoadingAssistance', () => {
      const flutterPayload = {
        pickup: { latitude: 12.9716, longitude: 77.5946 },
        destination: { latitude: 12.9352, longitude: 77.6245 },
        sector: 'logistics',
        vehicleCategory: 'mini_truck',
        weightKg: 50,
        hasLoadingAssistance: true,
      };

      const parsed = fareEstimateSchema.parse(flutterPayload);
      expect(parsed.sector).toBe('logistics');
      expect(parsed.vehicleCategory).toBe('mini_truck');
      expect(parsed.weightKg).toBe(50);
      expect(parsed.hasLoadingAssistance).toBe(true);
    });

    it('accepts Service payload with vehicleCategory towing', () => {
      const flutterPayload = {
        pickup: { latitude: 12.9716, longitude: 77.5946 },
        destination: { latitude: 12.9352, longitude: 77.6245 },
        sector: 'service',
        vehicleCategory: 'towing',
      };

      const parsed = fareEstimateSchema.parse(flutterPayload);
      expect(parsed.sector).toBe('service');
      expect(parsed.vehicleCategory).toBe('towing');
    });

    it('accepts Premium payload with rentalHours and fuelRatePerKm', () => {
      const flutterPayload = {
        pickup: { latitude: 12.9716, longitude: 77.5946 },
        destination: { latitude: 12.9352, longitude: 77.6245 },
        sector: 'premium',
        vehicleCategory: 'fortuner',
        rentalHours: 4,
        fuelRatePerKm: 18,
      };

      const parsed = fareEstimateSchema.parse(flutterPayload);
      expect(parsed.sector).toBe('premium');
      expect(parsed.vehicleCategory).toBe('fortuner');
      expect(parsed.rentalHours).toBe(4);
      expect(parsed.fuelRatePerKm).toBe(18);
    });
  });

  describe('BUG-P3-03: Towing Canonical Category Pricing', () => {
    it('canonical "towing" category receives specialized towing pricing', () => {
      const result = calculator.calculate({
        distanceMeters: 10000,
        durationSeconds: 900,
        sector: 'service',
        vehicleCategory: 'towing',
      });

      // Towing base is ₹600 (60000 paise) + ₹30/km (3000 paise/km)
      expect(result.baseAmount).toBe(60000);
      expect(result.distanceAmount).toBe(30000);
      expect(result.grossAmount).toBe(97650); // (60000 base + 30000 dist + 3000 time) * 1.05 GST = 97650
    });

    it('alias "towing_van" receives identical pricing to canonical "towing"', () => {
      const canonicalResult = calculator.calculate({
        distanceMeters: 15000,
        durationSeconds: 1200,
        sector: 'service',
        vehicleCategory: 'towing',
      });

      const aliasResult = calculator.calculate({
        distanceMeters: 15000,
        durationSeconds: 1200,
        sector: 'service',
        vehicleCategory: 'towing_van',
      });

      expect(aliasResult.baseAmount).toBe(canonicalResult.baseAmount);
      expect(aliasResult.distanceAmount).toBe(canonicalResult.distanceAmount);
      expect(aliasResult.grossAmount).toBe(canonicalResult.grossAmount);
    });
  });

  describe('BUG-P3-05: Backend Fare Estimation Without Google Maps', () => {
    const origin = { latitude: 12.9716, longitude: 77.5946 };
    const destination = { latitude: 12.9352, longitude: 77.6245 };

    it('accurately computes straight-line Haversine distance between Bangalore coordinates', () => {
      const distanceMeters = calculateHaversineDistanceMeters(origin, destination);
      // Bangalore MG Road to Koramangala is approximately 5.2 - 5.5 km straight-line
      expect(distanceMeters).toBeGreaterThan(4500);
      expect(distanceMeters).toBeLessThan(6000);
    });

    it('returns google_maps_road routeSource when Google Maps is operational', async () => {
      const service = new FareEstimateService(mockMapProvider, calculator);
      const estimate = await service.estimate(origin, destination, {
        sector: 'passenger',
        vehicleCategory: 'sedan',
      });

      expect(estimate.routeSource).toBe('google_maps_road');
      expect(estimate.straightLineDistanceMeters).toBeUndefined();
      expect(estimate.grossAmount).toBeGreaterThan(0);
    });

    it('falls back to haversine_estimated when Google Maps returns null and clearly labels the source', async () => {
      const service = new FareEstimateService(nullMapProvider, calculator);
      const estimate = await service.estimate(origin, destination, {
        sector: 'passenger',
        vehicleCategory: 'sedan',
      });

      expect(estimate.routeSource).toBe('haversine_estimated');
      expect(estimate.straightLineDistanceMeters).toBeDefined();
      expect(estimate.straightLineDistanceMeters).toBeGreaterThan(4500);
      expect(estimate.grossAmount).toBeGreaterThan(0);
    });

    it('supports custom fallback configuration (speed, detour factor)', async () => {
      const service = new FareEstimateService(nullMapProvider, calculator);
      const customEstimate = await service.estimate(origin, destination, {
        sector: 'passenger',
        vehicleCategory: 'sedan',
        fallbackConfig: {
          averageSpeedKmph: 40,
          estimatedDetourFactor: 1.5,
        },
      });

      expect(customEstimate.routeSource).toBe('haversine_estimated');
      expect(customEstimate.grossAmount).toBeGreaterThan(0);
    });

    it('throws when allowFallback is explicitly set to false and Google Maps is unavailable', async () => {
      const service = new FareEstimateService(nullMapProvider, calculator);
      await expect(
        service.estimate(origin, destination, {
          sector: 'passenger',
          fallbackConfig: { allowFallback: false },
        }),
      ).rejects.toThrow('Route could not be calculated and fallback is disabled');
    });
  });
});
