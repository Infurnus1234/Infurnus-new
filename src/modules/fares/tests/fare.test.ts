import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_FARE_PRICING } from '../config/fare.config.js';
import { FareController } from '../controllers/fare.controller.js';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import {
  FareEstimateService,
  type FallbackRouteConfig,
} from '../services/fare-estimate.service.js';

import type { Coordinates, MapProvider, RouteResult } from '../../rides/providers/map.provider.js';

import type { FarePricingConfig } from '../types/fare.js';

describe('INFURNUS Fare Module', () => {
  describe('FareCalculatorService', () => {
    const pricing: FarePricingConfig = {
      baseFare: 500,
      distanceRatePerKm: 1200,
      timeRatePerMinute: 200,
      currency: 'INR',
      pricingVersion: 'test-v1',
    };

    const calculator = new FareCalculatorService(pricing);

    it('calculates the fare correctly', () => {
      const result = calculator.calculate({
        distanceMeters: 5000,
        durationSeconds: 900,
        currency: 'INR',
      });

      expect(result).toEqual({
        distanceMeters: 5000,
        durationSeconds: 900,
        baseAmount: 500,
        distanceAmount: 6000,
        timeAmount: 3000,
        grossAmount: 9500,
        currency: 'INR',
        pricingVersion: 'test-v1',
      });
    });

    it('uses INR when currency is omitted', () => {
      const result = calculator.calculate({
        distanceMeters: 1000,
        durationSeconds: 60,
      });

      expect(result.currency).toBe('INR');
      expect(result.grossAmount).toBe(1900);
    });

    it('supports zero distance and duration', () => {
      const result = calculator.calculate({
        distanceMeters: 0,
        durationSeconds: 0,
      });

      expect(result.baseAmount).toBe(500);
      expect(result.distanceAmount).toBe(0);
      expect(result.timeAmount).toBe(0);
      expect(result.grossAmount).toBe(500);
    });

    it('rounds fractional distance fare to the nearest paise', () => {
      const result = calculator.calculate({
        distanceMeters: 1,
        durationSeconds: 0,
      });

      expect(result.distanceAmount).toBe(1);
      expect(result.grossAmount).toBe(501);
    });

    it('rounds fractional time fare to the nearest paise', () => {
      const result = calculator.calculate({
        distanceMeters: 0,
        durationSeconds: 1,
      });

      expect(result.timeAmount).toBe(3);
      expect(result.grossAmount).toBe(503);
    });

    it('rejects negative distance', () => {
      expect(() =>
        calculator.calculate({
          distanceMeters: -1,
          durationSeconds: 60,
        }),
      ).toThrow('distanceMeters cannot be negative');
    });

    it('rejects negative duration', () => {
      expect(() =>
        calculator.calculate({
          distanceMeters: 1000,
          durationSeconds: -1,
        }),
      ).toThrow('durationSeconds cannot be negative');
    });

    it('rejects non-finite distance', () => {
      expect(() =>
        calculator.calculate({
          distanceMeters: Number.NaN,
          durationSeconds: 60,
        }),
      ).toThrow('distanceMeters must be a finite number');
    });

    it('rejects non-finite duration', () => {
      expect(() =>
        calculator.calculate({
          distanceMeters: 1000,
          durationSeconds: Number.POSITIVE_INFINITY,
        }),
      ).toThrow('durationSeconds must be a finite number');
    });

    it('rejects unsupported currency', () => {
      expect(() =>
        calculator.calculate({
          distanceMeters: 1000,
          durationSeconds: 60,
          currency: 'USD' as 'INR',
        }),
      ).toThrow('Unsupported fare currency: USD');
    });

    it('rejects negative base fare configuration', () => {
      const invalidCalculator = new FareCalculatorService({
        ...pricing,
        baseFare: -1,
      });

      expect(() =>
        invalidCalculator.calculate({
          distanceMeters: 1000,
          durationSeconds: 60,
        }),
      ).toThrow('Invalid fare pricing value for baseFare');
    });

    it('rejects negative distance rate configuration', () => {
      const invalidCalculator = new FareCalculatorService({
        ...pricing,
        distanceRatePerKm: -1,
      });

      expect(() =>
        invalidCalculator.calculate({
          distanceMeters: 1000,
          durationSeconds: 60,
        }),
      ).toThrow('Invalid fare pricing value for distanceRatePerKm');
    });

    it('rejects negative time rate configuration', () => {
      const invalidCalculator = new FareCalculatorService({
        ...pricing,
        timeRatePerMinute: -1,
      });

      expect(() =>
        invalidCalculator.calculate({
          distanceMeters: 1000,
          durationSeconds: 60,
        }),
      ).toThrow('Invalid fare pricing value for timeRatePerMinute');
    });

    it('rejects unsafe integer pricing values', () => {
      const invalidCalculator = new FareCalculatorService({
        ...pricing,
        baseFare: Number.MAX_SAFE_INTEGER + 1,
      });

      expect(() =>
        invalidCalculator.calculate({
          distanceMeters: 1000,
          durationSeconds: 60,
        }),
      ).toThrow('Invalid fare pricing value for baseFare');
    });

    it('rejects an empty pricing version', () => {
      const invalidCalculator = new FareCalculatorService({
        ...pricing,
        pricingVersion: '   ',
      });

      expect(() =>
        invalidCalculator.calculate({
          distanceMeters: 1000,
          durationSeconds: 60,
        }),
      ).toThrow('pricingVersion cannot be empty');
    });

    it('rejects unsupported pricing currency', () => {
      const invalidCalculator = new FareCalculatorService({
        ...pricing,
        currency: 'USD' as 'INR',
      });

      expect(() =>
        invalidCalculator.calculate({
          distanceMeters: 1000,
          durationSeconds: 60,
        }),
      ).toThrow('Unsupported fare pricing currency: USD');
    });

    it('uses the default production pricing configuration', () => {
      const defaultCalculator = new FareCalculatorService();

      const result = defaultCalculator.calculate({
        distanceMeters: 5000,
        durationSeconds: 900,
      });

      expect(result).toMatchObject({
        baseAmount: DEFAULT_FARE_PRICING.baseFare,
        distanceAmount: 6000,
        timeAmount: 3000,
        grossAmount: 9500,
        currency: 'INR',
        pricingVersion: 'v1',
      });
    });
  });

  describe('FareEstimateService', () => {
    const origin: Coordinates = {
      latitude: 26.9124,
      longitude: 75.7873,
    };

    const destination: Coordinates = {
      latitude: 26.8467,
      longitude: 75.802,
    };

    const pricing: FarePricingConfig = {
      baseFare: 500,
      distanceRatePerKm: 1200,
      timeRatePerMinute: 200,
      currency: 'INR',
      pricingVersion: 'test-v1',
    };

    function createService(
      route: RouteResult | null,
      fallbackConfig: FallbackRouteConfig = { allowFallback: false },
    ) {
      const calculateRoute = vi.fn().mockResolvedValue(route);

      const mapProvider: MapProvider = {
        calculateRoute,
        calculateMatrix: vi.fn(),
        geocode: vi.fn(),
        places: vi.fn(),
      };

      const fareCalculator = new FareCalculatorService(pricing);

      return {
        service: new FareEstimateService(mapProvider, fareCalculator, fallbackConfig),
        calculateRoute,
      };
    }

    it('calculates a fare from the route returned by the map provider', async () => {
      const route: RouteResult = {
        distanceMeters: 5000,
        durationSeconds: 900,
        encodedPolyline: 'test-polyline',
      };

      const { service, calculateRoute } = createService(route);

      const result = await service.estimate(origin, destination);

      expect(calculateRoute).toHaveBeenCalledOnce();
      expect(calculateRoute).toHaveBeenCalledWith(origin, destination);

      expect(result).toEqual({
        distanceMeters: 5000,
        durationSeconds: 900,
        baseAmount: 500,
        distanceAmount: 6000,
        timeAmount: 3000,
        grossAmount: 9500,
        currency: 'INR',
        pricingVersion: 'test-v1',
        routeSource: 'google_maps_road',
      });
    });

    it('throws when the map provider cannot calculate a route and fallback is disabled', async () => {
      const { service, calculateRoute } = createService(null, { allowFallback: false });

      await expect(service.estimate(origin, destination)).rejects.toThrow(
        'Route could not be calculated',
      );

      expect(calculateRoute).toHaveBeenCalledOnce();
    });

    it('passes exact route distance and duration to fare calculation', async () => {
      const route: RouteResult = {
        distanceMeters: 12345,
        durationSeconds: 2345,
      };

      const { service } = createService(route);

      const result = await service.estimate(origin, destination);

      expect(result.distanceMeters).toBe(12345);
      expect(result.durationSeconds).toBe(2345);
    });

    it('falls back to haversine estimation when map provider fails and fallback is enabled', async () => {
      const { service } = createService(null, { allowFallback: true });

      const result = await service.estimate(origin, destination);

      expect(result.routeSource).toBe('haversine_estimated');
      expect(result.straightLineDistanceMeters).toBeGreaterThan(0);
      expect(result.grossAmount).toBeGreaterThan(0);
    });

    it('does not calculate a fare when route calculation fails and fallback is disabled', async () => {
      const { service } = createService(null, { allowFallback: false });

      await expect(service.estimate(origin, destination)).rejects.toThrow(
        'Route could not be calculated',
      );
    });

    it('does not require a polyline to calculate the fare', async () => {
      const route: RouteResult = {
        distanceMeters: 1000,
        durationSeconds: 60,
      };

      const { service } = createService(route);

      const result = await service.estimate(origin, destination);

      expect(result.grossAmount).toBe(1900);
    });
  });

  describe('FareController', () => {
    const fare = {
      distanceMeters: 5000,
      durationSeconds: 900,
      baseAmount: 500,
      distanceAmount: 6000,
      timeAmount: 3000,
      grossAmount: 9500,
      currency: 'INR' as const,
      pricingVersion: 'v1',
    };

    const validBody = {
      pickup: {
        latitude: 26.9124,
        longitude: 75.7873,
      },
      destination: {
        latitude: 26.8467,
        longitude: 75.802,
      },
    };

    function createController() {
      const estimate = vi.fn().mockResolvedValue(fare);

      const service = {
        estimate,
      } as unknown as import('../services/fare-estimate.service.js').FareEstimateService;

      return {
        controller: new FareController(service),
        estimate,
      };
    }

    it('estimates fare and returns the standard success response', async () => {
      const { controller, estimate } = createController();

      const req = {
        body: validBody,
      } as unknown as Request;

      const res = {
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn();

      await controller.estimate(req, res, next);

      expect(estimate).toHaveBeenCalledOnce();
      expect(estimate).toHaveBeenCalledWith(validBody.pickup, validBody.destination);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: fare,
        message: 'Fare estimated',
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('passes service errors to next middleware', async () => {
      const error = new Error('Route could not be calculated');

      const estimate = vi.fn().mockRejectedValue(error);

      const service = {
        estimate,
      } as unknown as import('../services/fare-estimate.service.js').FareEstimateService;

      const controller = new FareController(service);

      const req = {
        body: validBody,
      } as unknown as Request;

      const res = {
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn();

      await controller.estimate(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('rejects invalid request data through Zod parsing', async () => {
      const { controller, estimate } = createController();

      const req = {
        body: {
          pickup: {
            latitude: 91,
            longitude: 77.7873,
          },
          destination: validBody.destination,
        },
      } as unknown as Request;

      const res = {
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn();

      await controller.estimate(req, res, next);

      expect(estimate).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('rejects unexpected request fields', async () => {
      const { controller, estimate } = createController();

      const req = {
        body: {
          ...validBody,
          amount: 100,
        },
      } as unknown as Request;

      const res = {
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn();

      await controller.estimate(req, res, next);

      expect(estimate).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
