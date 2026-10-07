import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import { FareEstimateService } from '../services/fare-estimate.service.js';
import { FareController } from '../controllers/fare.controller.js';
import { VEHICLE_FARE_PRICING, VEHICLE_UNAVAILABLE_MESSAGE } from '../config/fare.config.js';
import { RideService } from '../../rides/services/ride.service.js';
import { errorMiddleware } from '../../../common/middleware/error.middleware.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import { fareEstimateSchema } from '../../rides/schemas/ride.schemas.js';

const calculator = new FareCalculatorService();
const routeInput = { distanceMeters: 10000, durationSeconds: 600 };
const pickup = { latitude: 12, longitude: 77 };
const destination = { latitude: 13, longitude: 78 };
function createEstimator(pricing = VEHICLE_FARE_PRICING) {
  const calculateRoute = vi.fn().mockResolvedValue(routeInput);
  const maps = {
    calculateRoute,
    calculateMatrix: vi.fn(),
    geocode: vi.fn(),
    places: vi.fn(),
  } as MapProvider;
  return {
    calculateRoute,
    estimator: new FareEstimateService(maps, new FareCalculatorService(undefined, pricing)),
  };
}

describe('Vehicle fare ranges', () => {
  it.each([
    { sector: undefined, vehicleCategory: 'bike' },
    { sector: 'passenger' as const, vehicleCategory: '' },
  ])('rejects missing estimate selection %j', (selection) => {
    expect(() => calculator.calculateEstimate({ ...routeInput, ...selection })).toThrow(
      expect.objectContaining({ code: 'FARE_INPUT_INVALID', statusCode: 400 }),
    );
  });
  it.each([
    ['passenger', 'bike', 1500, 2000, 500, 800],
    ['passenger', 'auto', 2000, 2500, 800, 1100],
    ['passenger', 'mini', 4000, 8000, 900, 1100],
    ['passenger', 'sedan', 6500, 10000, 1200, 1500],
    ['passenger', 'suv', 9000, 12000, 1600, 2200],
    ['logistics', 'three_wheeler', 20000, 20000, 1500, 2000],
    ['logistics', 'mini_truck', 23500, 32500, 1800, 2200],
    ['logistics', 'pickup_8ft', 32500, 37500, 2000, 2500],
  ] as const)(
    'preserves %s/%s rates and existing time/tax charges',
    (sector, vehicleCategory, lowBase, highBase, lowRate, highRate) => {
      const result = calculator.calculateEstimate({ ...routeInput, sector, vehicleCategory });
      expect('estimateType' in result && result.estimateType).toBe('range');
      if (!('estimatedFare' in result) || !result.estimatedFare) throw new Error('Missing range');
      expect(result.estimatedFare.minimum.baseAmount).toBe(lowBase);
      expect(result.estimatedFare.maximum?.baseAmount).toBe(highBase);
      expect(result.estimatedFare.minimum.distanceAmount).toBe(lowRate * 10);
      expect(result.estimatedFare.maximum?.distanceAmount).toBe(highRate * 10);
      const taxFactor = sector === 'logistics' ? 1.05 : 1;
      expect(result.estimatedFare.minimum.grossAmount).toBe(
        Math.round((lowBase + lowRate * 10 + 2000) * taxFactor),
      );
      expect(result.estimatedFare.maximum?.grossAmount).toBe(
        Math.round((highBase + highRate * 10 + 2000) * taxFactor),
      );
      expect(result.bookable).toBe(false);
      expect(result).not.toHaveProperty('grossAmount');
    },
  );
  it('keeps Tata 407 upper base and fare open', () => {
    const result = calculator.calculateEstimate({
      ...routeInput,
      sector: 'logistics',
      vehicleCategory: 'tata_407',
    });
    expect(result).toMatchObject({
      estimatedFare: { minimum: { baseAmount: 77500, distanceAmount: 25000 }, maximum: null },
      bookable: false,
    });
  });
  it('does not invent an FTL truck-size or route tariff', () => {
    const result = calculator.calculateEstimate({
      ...routeInput,
      sector: 'logistics',
      vehicleCategory: 'ftl',
    });
    expect(result).toMatchObject({
      estimateType: 'quote_required',
      bookable: false,
      pricing: { baseFare: null, perKmRate: { minimum: 2600, maximum: 9100 } },
    });
    expect(result).not.toHaveProperty('estimatedFare');
    expect(result).not.toHaveProperty('grossAmount');
  });
  it('maps mini_cab to the existing mini pricing without changing the fleet identifier', () => {
    const canonical = calculator.calculateEstimate({
      ...routeInput,
      sector: 'passenger',
      vehicleCategory: 'mini',
    });
    const alias = calculator.calculateEstimate({
      ...routeInput,
      sector: 'passenger',
      vehicleCategory: 'mini_cab',
    });
    expect(alias).toMatchObject({
      vehicleCategory: 'mini_cab',
      pricing: { displayName: 'Mini Cab' },
    });
    expect('estimatedFare' in alias && alias.estimatedFare).toEqual(
      'estimatedFare' in canonical && canonical.estimatedFare,
    );
  });
  it('preserves waiting, cargo, loading and tax without applying old vehicle multipliers', () => {
    const result = calculator.calculateEstimate({
      ...routeInput,
      sector: 'logistics',
      vehicleCategory: 'mini_truck',
      waitingMinutes: 5,
      weightKg: 30,
      hasLoadingAssistance: true,
    });
    expect(result).toMatchObject({
      estimatedFare: {
        minimum: {
          baseAmount: 23500,
          distanceAmount: 18000,
          timeAmount: 2000,
          waitingAmount: 400,
          weightAmount: 5000,
          loadingAmount: 15000,
          grossAmount: 67095,
        },
      },
    });
  });
  it.each([NaN, Infinity, -1])('rejects invalid distance %s', (distanceMeters) => {
    expect(() =>
      calculator.calculateEstimate({
        ...routeInput,
        distanceMeters,
        sector: 'passenger',
        vehicleCategory: 'bike',
      }),
    ).toThrow();
  });
  it('supports zero route distance without a fabricated minimum distance', () => {
    expect(
      calculator.calculateEstimate({
        distanceMeters: 0,
        durationSeconds: 0,
        sector: 'passenger',
        vehicleCategory: 'bike',
      }),
    ).toMatchObject({
      estimatedFare: { minimum: { grossAmount: 1500 }, maximum: { grossAmount: 2000 } },
    });
  });
  it.each(['unknown', 'constructor', '__proto__'])(
    'rejects unconfigured category %s explicitly',
    (vehicleCategory) => {
      expect(() =>
        calculator.calculateEstimate({ ...routeInput, sector: 'passenger', vehicleCategory }),
      ).toThrow(
        expect.objectContaining({
          code: 'FARE_CONFIGURATION_MISSING',
          message: VEHICLE_UNAVAILABLE_MESSAGE,
          statusCode: 422,
        }),
      );
    },
  );
  it('does not reuse a passenger tariff for an unsupported goods category', () => {
    expect(() =>
      calculator.calculateEstimate({ ...routeInput, sector: 'logistics', vehicleCategory: 'suv' }),
    ).toThrow(expect.objectContaining({ code: 'FARE_CONFIGURATION_MISSING' }));
  });
  it('rejects missing pricing configuration', () => {
    const empty = new FareCalculatorService(undefined, {});
    expect(() =>
      empty.calculateEstimate({ ...routeInput, sector: 'passenger', vehicleCategory: 'bike' }),
    ).toThrow(expect.objectContaining({ code: 'FARE_CONFIGURATION_MISSING' }));
  });
  it.each([
    { baseFare: { minimum: -1, maximum: 2000 } },
    { perKmRate: { minimum: 900, maximum: 500 } },
    { fixedRates: { baseFare: 99999, distanceRatePerKm: 500 } },
    { fixedRates: { baseFare: 1400, distanceRatePerKm: 500 } },
    { fixedRates: { baseFare: 1500, distanceRatePerKm: 499 } },
    { fixedRates: { baseFare: 1500, distanceRatePerKm: 801 } },
    { fixedRates: { baseFare: NaN, distanceRatePerKm: 500 } },
    { fixedRates: { baseFare: 1500.5, distanceRatePerKm: 500 } },
    { fixedRates: { baseFare: 1500, distanceRatePerKm: Infinity } },
  ])('rejects invalid tariff configuration %j', (override) => {
    const tariff = { ...VEHICLE_FARE_PRICING.passenger!.bike!, ...override };
    const invalid = new FareCalculatorService(undefined, { passenger: { bike: tariff } });
    expect(() =>
      invalid.calculateEstimate({ ...routeInput, sector: 'passenger', vehicleCategory: 'bike' }),
    ).toThrow(expect.objectContaining({ code: 'FARE_PRICING_INVALID', statusCode: 503 }));
  });
  it('requires sector and vehicle in the public request', () => {
    expect(fareEstimateSchema.safeParse({ pickup, destination }).success).toBe(false);
  });
});

describe('Estimate API and booking integration', () => {
  it('returns the range in the existing success envelope', async () => {
    const { estimator, calculateRoute } = createEstimator();
    const app = express();
    app.use(express.json());
    app.post('/fares/estimate', new FareController(estimator).estimate);
    app.use(errorMiddleware);
    const response = await request(app)
      .post('/fares/estimate')
      .send({ pickup, destination, sector: 'passenger', vehicleCategory: 'bike' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Fare estimated',
      data: { estimateType: 'range', bookable: false, routeSource: 'google_maps_road' },
    });
    expect(response.body.data).not.toHaveProperty('grossAmount');
    expect(calculateRoute).toHaveBeenCalledOnce();
  });
  it('returns explicit unsupported-pricing error before routing', async () => {
    const { estimator, calculateRoute } = createEstimator();
    const app = express();
    app.use(express.json());
    app.post('/fares/estimate', new FareController(estimator).estimate);
    app.use(errorMiddleware);
    const response = await request(app)
      .post('/fares/estimate')
      .send({ pickup, destination, sector: 'passenger', vehicleCategory: 'spaceship' });
    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'FARE_CONFIGURATION_MISSING', message: VEHICLE_UNAVAILABLE_MESSAGE },
    });
    expect(calculateRoute).not.toHaveBeenCalled();
  });
  it('does not create a booking from a range or client-supplied fare', async () => {
    const { estimator } = createEstimator();
    const create = vi.fn();
    const service = new RideService(
      { create } as unknown as RideRepository,
      undefined,
      undefined,
      estimator,
    );
    await expect(
      service.createRide('customer', {
        pickup,
        destination,
        sector: 'passenger',
        vehicleCategory: 'bike',
        fareEstimate: 1,
      }),
    ).rejects.toMatchObject({ code: 'FARE_FIXED_QUOTE_REQUIRED' });
    expect(create).not.toHaveBeenCalled();
  });
  it('books only the explicit server-configured fixed tariff', async () => {
    const tariff = {
      ...VEHICLE_FARE_PRICING.passenger!.bike!,
      fixedRates: { baseFare: 1800, distanceRatePerKm: 600 },
    };
    const { estimator } = createEstimator({ passenger: { bike: tariff } });
    const create = vi.fn().mockResolvedValue({ id: 'ride', driverDetails: null });
    const service = new RideService(
      { create } as unknown as RideRepository,
      undefined,
      undefined,
      estimator,
    );
    await service.createRide('customer', {
      pickup,
      destination,
      sector: 'passenger',
      vehicleCategory: 'bike',
      fareEstimate: 1,
    });
    expect(create).toHaveBeenCalledWith('customer', expect.objectContaining({ fareEstimate: 98 }));
  });
  it('retains labelled route fallback for ranges', async () => {
    const { estimator, calculateRoute } = createEstimator();
    calculateRoute.mockResolvedValue(null);
    const result = await estimator.estimate(pickup, destination, {
      sector: 'passenger',
      vehicleCategory: 'bike',
      pricingMode: 'vehicle_range',
    });
    expect(result).toMatchObject({
      estimateType: 'range',
      routeSource: 'haversine_estimated',
      bookable: false,
    });
  });
});

describe('Follow-up booking guards', () => {
  it.each([
    { estimateType: 'quote_required', bookable: false, bookingFare: { grossAmount: 100 } },
    { estimateType: 'range', bookable: false, bookingFare: { grossAmount: 100 } },
    { estimateType: 'range', bookable: true, bookingFare: { grossAmount: NaN } },
    { estimateType: 'range', bookable: true, bookingFare: { grossAmount: -100 } },
    { estimateType: 'range', bookable: true, bookingFare: { grossAmount: 1.5 } },
  ])('rejects inconsistent or invalid estimator quote %j before creation', async (result) => {
    const create = vi.fn();
    const estimator = {
      estimate: vi.fn().mockResolvedValue(result),
    } as unknown as FareEstimateService;
    const service = new RideService(
      { create } as unknown as RideRepository,
      undefined,
      undefined,
      estimator,
    );
    await expect(
      service.createRide('customer', {
        pickup,
        destination,
        sector: 'passenger',
        vehicleCategory: 'bike',
        fareEstimate: 1,
      }),
    ).rejects.toMatchObject({ code: 'FARE_FIXED_QUOTE_REQUIRED' });
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects real FTL booking without creating a ride', async () => {
    const { estimator } = createEstimator();
    const create = vi.fn();
    const service = new RideService(
      { create } as unknown as RideRepository,
      undefined,
      undefined,
      estimator,
    );
    await expect(
      service.createRide('customer', {
        pickup,
        destination,
        sector: 'logistics',
        vehicleCategory: 'ftl',
        fareEstimate: 1,
      }),
    ).rejects.toMatchObject({ code: 'FARE_FIXED_QUOTE_REQUIRED' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('Follow-up calculator isolation', () => {
  it('does not evaluate obsolete scalar distance rates for vehicle ranges', () => {
    const engine = new FareCalculatorService({
      baseFare: 5000,
      distanceRatePerKm: Number.MAX_SAFE_INTEGER,
      timeRatePerMinute: 200,
      currency: 'INR',
      pricingVersion: 'legacy',
    });
    expect(
      engine.calculateEstimate({
        distanceMeters: 2000,
        durationSeconds: 0,
        sector: 'passenger',
        vehicleCategory: 'bike',
      }),
    ).toMatchObject({
      estimatedFare: { minimum: { grossAmount: 2500 }, maximum: { grossAmount: 3600 } },
    });
  });
});

describe('Final end-to-end fare validation', () => {
  it.each([
    { latitude: NaN, longitude: 77 },
    { latitude: 91, longitude: 77 },
    { latitude: 12, longitude: 181 },
    { latitude: 12, longitude: Infinity },
  ])('rejects invalid direct-service coordinates before routing %j', async (origin) => {
    const { estimator, calculateRoute } = createEstimator();
    await expect(estimator.estimate(origin, destination)).rejects.toMatchObject({
      code: 'FARE_INPUT_INVALID',
      statusCode: 400,
    });
    expect(calculateRoute).not.toHaveBeenCalled();
  });
  it.each([
    { distanceMeters: -1, durationSeconds: 60 },
    { distanceMeters: NaN, durationSeconds: 60 },
    { distanceMeters: 1000, durationSeconds: Infinity },
    { distanceMeters: 1000, durationSeconds: -1 },
  ])('rejects malformed provider route data %j', async (route) => {
    const { estimator, calculateRoute } = createEstimator();
    calculateRoute.mockResolvedValue(route);
    await expect(estimator.estimate(pickup, destination)).rejects.toMatchObject({
      code: 'FARE_ROUTE_INVALID',
      statusCode: 503,
    });
  });
  it.each([
    { averageSpeedKmph: 0 },
    { averageSpeedKmph: -1 },
    { estimatedDetourFactor: NaN },
    { estimatedDetourFactor: 0 },
  ])('rejects invalid configured fallback %j', async (fallbackConfig) => {
    const { estimator, calculateRoute } = createEstimator();
    calculateRoute.mockResolvedValue(null);
    await expect(estimator.estimate(pickup, destination, { fallbackConfig })).rejects.toMatchObject(
      { code: 'FARE_PRICING_INVALID' },
    );
  });
  it('propagates a structured provider failure without leaking its arbitrary message', async () => {
    const { estimator, calculateRoute } = createEstimator();
    calculateRoute.mockRejectedValue(new Error('provider internal details'));
    const app = express();
    app.use(express.json());
    app.post('/fares/estimate', new FareController(estimator).estimate);
    app.use(errorMiddleware);
    const response = await request(app)
      .post('/fares/estimate')
      .send({ pickup, destination, sector: 'passenger', vehicleCategory: 'bike' });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('FARE_ROUTE_UNAVAILABLE');
    expect(response.body.error.message).not.toContain('provider internal');
  });
  it.each([
    { baseFare: 1500, distanceRatePerKm: 500 },
    { baseFare: 2000, distanceRatePerKm: 800 },
  ])('accepts explicitly configured boundary rates %j', (fixedRates) => {
    const engine = new FareCalculatorService(undefined, {
      passenger: { bike: { ...VEHICLE_FARE_PRICING.passenger!.bike!, fixedRates } },
    });
    const fare = engine.calculateEstimate({
      ...routeInput,
      sector: 'passenger',
      vehicleCategory: 'bike',
    });
    expect(fare).toMatchObject({
      estimateType: 'range',
      bookable: true,
      bookingFare: { grossAmount: fixedRates.baseFare + 10 * fixedRates.distanceRatePerKm + 2000 },
    });
  });
  it('uses identical approved pricing and waiting input for estimate and booking', async () => {
    const { estimator } = createEstimator({
      passenger: {
        bike: {
          ...VEHICLE_FARE_PRICING.passenger!.bike!,
          fixedRates: { baseFare: 1800, distanceRatePerKm: 600 },
        },
      },
    });
    const create = vi.fn().mockResolvedValue({ id: 'ride', driverDetails: null });
    const app = express();
    app.use(express.json());
    app.post('/fares/estimate', new FareController(estimator).estimate);
    app.use(errorMiddleware);
    const input = {
      pickup,
      destination,
      sector: 'passenger' as const,
      vehicleCategory: 'bike',
      waitingMinutes: 5,
    };
    const response = await request(app).post('/fares/estimate').send(input);
    expect(response.status).toBe(200);
    expect(response.body.data.bookingFare.grossAmount).toBe(10200);
    await new RideService(
      { create } as unknown as RideRepository,
      undefined,
      undefined,
      estimator,
    ).createRide('customer', { ...input, fareEstimate: 1 });
    expect(create).toHaveBeenCalledWith('customer', expect.objectContaining({ fareEstimate: 102 }));
  });
  it('FTL remains unavailable with valid route metadata and cannot accept invented truck-size fields', async () => {
    const { estimator } = createEstimator();
    const fare = await estimator.estimate(pickup, destination, {
      pricingMode: 'vehicle_range',
      sector: 'logistics',
      vehicleCategory: 'ftl',
    });
    expect(fare).toMatchObject({
      estimateType: 'quote_required',
      bookable: false,
      message: VEHICLE_UNAVAILABLE_MESSAGE,
    });
    expect(fare).not.toHaveProperty('grossAmount');
    expect(fare).not.toHaveProperty('bookingFare');
    expect(
      fareEstimateSchema.safeParse({
        pickup,
        destination,
        sector: 'logistics',
        vehicleCategory: 'ftl',
        truckSize: 'large',
      }).success,
    ).toBe(false);
    await expect(
      estimator.estimate(pickup, destination, {
        pricingMode: 'vehicle_range',
        sector: 'logistics',
        vehicleCategory: 'ftl_large',
      }),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
  });
});

describe('Persistence amount validation', () => {
  it('rejects a quote beyond the actual NUMERIC(10,2) database capacity before insertion', async () => {
    const create = vi.fn();
    const estimator = {
      estimate: vi.fn().mockResolvedValue({ grossAmount: 10_000_000_000 }),
    } as unknown as FareEstimateService;
    const service = new RideService(
      { create } as unknown as RideRepository,
      undefined,
      undefined,
      estimator,
    );
    await expect(
      service.createRide('customer', {
        pickup,
        destination,
        sector: 'passenger',
        vehicleCategory: 'bike',
      }),
    ).rejects.toMatchObject({ code: 'FARE_AMOUNT_UNSUPPORTED', statusCode: 422 });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('Existing rental input compatibility', () => {
  it('uses the existing rentalHours alias consistently across estimate and booking', async () => {
    const { estimator } = createEstimator();
    const app = express();
    app.use(express.json());
    app.post('/fares/estimate', new FareController(estimator).estimate);
    app.use(errorMiddleware);
    const input = {
      pickup,
      destination,
      sector: 'premium' as const,
      vehicleCategory: 'sedan',
      rentalDetails: { rentalHours: 3 },
    };
    const response = await request(app).post('/fares/estimate').send(input);
    expect(response.status).toBe(200);
    expect(response.body.data.grossAmount).toBe(330750);
    const create = vi.fn().mockResolvedValue({ id: 'ride', driverDetails: null });
    await new RideService(
      { create } as unknown as RideRepository,
      undefined,
      undefined,
      estimator,
    ).createRide('customer', { ...input, fareEstimate: 1 });
    expect(create).toHaveBeenCalledWith(
      'customer',
      expect.objectContaining({ fareEstimate: 3307.5 }),
    );
  });
});
