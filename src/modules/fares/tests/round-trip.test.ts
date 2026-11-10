import { describe, expect, it, vi } from 'vitest';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import { FareEstimateService } from '../services/fare-estimate.service.js';
import type { VehicleType } from '../../vehicles/types/vehicle.js';
import type { VehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
const calculator = new FareCalculatorService();
const vehicle = (sector: VehicleType['sector'], rate: number): VehicleType => ({
  id: 'configured-test',
  code: 'configured_test',
  name: 'Local test',
  sector,
  baseFare: sector === 'service' ? null : 25,
  ...(sector === 'service' ? { serviceFixedFare: 25 } : {}),
  ...(sector === 'premium'
    ? { fixedHourlyPricing: { hourlyRate: 25, fuelRate: rate, fuelUnit: 'per_km' as const } }
    : {}),
  perKmRate: sector === 'service' ? null : rate,
  currency: 'INR',
  active: true,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
});
describe('Backend one-way route / round-trip billing contract', () => {
  it.each([
    [10_000, 'below_15', 10_000, 40_000, 50_000],
    [20_000, 'from_15', 20_000, 48_400, 68_400],
    [50_000, 'from_15', 20_000, 121_000, 141_000],
    [10_013, 'below_15', 10_000, 40_052, 50_100],
  ] as const)(
    'bills a %i m Logistics route using the %s tariff on the outbound distance',
    (distanceMeters, logisticsSlab, baseAmount, distanceAmount, grossAmount) => {
      const input = {
        sector: 'logistics' as const,
        vehicleCategory: 'configured_test',
        durationSeconds: 600,
        distanceMeters,
      };
      const type = {
        ...vehicle('logistics', 0),
        baseFare: null,
        perKmRate: null,
        logisticsSlabs: {
          below_15: { baseFare: 100, perKmRate: 20 },
          from_15: { baseFare: 200, perKmRate: 12.1 },
        },
      };
      const quote = calculator.calculateEstimate(input, type);
      expect(quote).toMatchObject({
        distanceMeters,
        oneWayDistanceMeters: distanceMeters,
        billableDistanceMeters: distanceMeters * 2,
        bookingFare: {
          distanceMeters,
          baseAmount,
          distanceAmount,
          grossAmount,
          vehicleConfiguration: { logisticsSlab },
          logisticsPayment: {
            totalPaise: grossAmount,
            upfrontPaise: Math.round((grossAmount / 100) * 0.4) * 100,
            finalPaise: grossAmount - Math.round((grossAmount / 100) * 0.4) * 100,
          },
        },
      });
      expect(calculator.calculateEstimate(input, type)).toEqual(quote);
    },
  );
  it.each(['passenger', 'service', 'premium'] as const)(
    'bills %s twice, preserves base, never mutates route input',
    (sector) => {
      const input = {
        distanceMeters: 10000,
        durationSeconds: 600,
        sector,
        ...(sector === 'premium' ? { bookingHours: 1 } : {}),
        vehicleCategory: 'configured_test',
      };
      const first = calculator.calculateEstimate(input, vehicle(sector, 5));
      const second = calculator.calculateEstimate(input, vehicle(sector, 5));
      expect(first).toEqual(second);
      expect(input.distanceMeters).toBe(10000);
      expect(first.distanceMeters).toBe(10000);
      expect(first.billableDistanceMeters).toBe(sector === 'service' ? 0 : 20000);
      if (!('bookingFare' in first)) throw Error('Missing booking fare');
      expect(first.bookingFare).toMatchObject({
        baseAmount: 2500,
        distanceAmount: sector === 'passenger' ? 10000 : 0,
        ...(sector === 'premium' ? { fuelAmount: 10000 } : {}),
        grossAmount: sector === 'service' ? 2500 : 12500,
        distanceMultiplier: sector === 'service' ? 1 : 2,
      });
      expect(first.estimatedFare?.minimum).toEqual(first.bookingFare);
    },
  );
  it.each([0, 3.25, 8.75])('uses configured rate %s and zero distance safely', (rate) => {
    const input = {
      distanceMeters: 10000,
      durationSeconds: 0,
      sector: 'passenger' as const,
      vehicleCategory: 'configured_test',
    };
    const result = calculator.calculateEstimate(input, vehicle('passenger', rate));
    if (!('bookingFare' in result)) throw Error('Missing quote');
    expect(result.bookingFare?.distanceAmount).toBe(Math.round(20 * rate * 100));
    const zero = calculator.calculateEstimate(
      { ...input, distanceMeters: 0 },
      vehicle('passenger', rate),
    );
    if (!('bookingFare' in zero)) throw Error('Missing quote');
    expect(zero.bookingFare?.grossAmount).toBe(2500);
  });
  it.each([-1, NaN, Infinity, Number.MAX_VALUE])(
    'rejects invalid/overflow route distance %s',
    (distanceMeters) => {
      expect(() =>
        calculator.calculateEstimate(
          {
            distanceMeters,
            durationSeconds: 0,
            sector: 'passenger',
            vehicleCategory: 'configured_test',
          },
          vehicle('passenger', 5),
        ),
      ).toThrow();
    },
  );
  it.each(['passenger', 'service', 'premium'] as const)(
    'enforces the configured %s reference-rate policy',
    (sector) => {
      const configured = {
        ...vehicle(sector, 5),
        baseFare: null,
        perKmRate: null,
        pricingReference: {
          displayName: 'Local range',
          baseFare: { minimum: 1500, maximum: 2000 },
          perKmRate: { minimum: 500, maximum: 800 },
        },
      };
      if (sector === 'premium') {
        const { fixedHourlyPricing: _fixed, ...legacy } = configured;
        expect(() =>
          calculator.calculateEstimate(
            {
              distanceMeters: 10000,
              durationSeconds: 0,
              sector,
              vehicleCategory: 'configured_test',
              bookingHours: 1,
            },
            legacy,
          ),
        ).toThrow(expect.objectContaining({ code: 'FARE_CONFIGURATION_MISSING' }));
        return;
      }
      if (sector === 'service') {
        expect(() =>
          calculator.calculateEstimate(
            {
              distanceMeters: 10000,
              durationSeconds: 0,
              sector,
              vehicleCategory: 'configured_test',
            },
            configured,
          ),
        ).toThrow(/disabled or its fixed fare/);
        return;
      }
      const result = calculator.calculateEstimate(
        { distanceMeters: 10000, durationSeconds: 0, sector, vehicleCategory: 'configured_test' },
        configured,
      );
      expect(result).toMatchObject({
        bookable: false,
        estimatedFare: {
          minimum: { baseAmount: 1500, distanceAmount: 10000 },
          maximum: { distanceAmount: 16000 },
        },
      });
    },
  );
  it('keeps configured FTL route-based with no arbitrary booking quote', () => {
    const configured = {
      ...vehicle('logistics', 0),
      code: 'ftl',
      baseFare: null,
      perKmRate: null,
      pricingReference: {
        displayName: 'FTL',
        baseFare: null,
        perKmRate: { minimum: 2600, maximum: 9100 },
        routeBased: true,
      },
    };
    expect(() =>
      calculator.calculateEstimate(
        {
          distanceMeters: 10000,
          durationSeconds: 600,
          sector: 'logistics',
          vehicleCategory: 'ftl',
        },
        configured,
      ),
    ).toThrow(/Configure both Logistics distance slabs/);
  });
  it('routes once per estimate and reloads updated persisted pricing', async () => {
    let configured = vehicle('passenger', 5);
    const route = vi.fn().mockResolvedValue({ distanceMeters: 10000, durationSeconds: 600 });
    const maps = { calculateRoute: route } as unknown as MapProvider;
    const repository = {
      findTypeByCode: vi.fn(async () => configured),
    } as unknown as VehicleRepository;
    const estimator = new FareEstimateService(
      maps,
      calculator,
      { allowFallback: false },
      repository,
    );
    const p = { latitude: 25.6, longitude: 85.1 };
    const options = {
      sector: 'passenger' as const,
      vehicleCategory: 'configured_test',
      pricingMode: 'vehicle_range' as const,
    };
    const first = await estimator.estimate(p, p, options);
    configured = { ...configured, perKmRate: 7, version: 2 };
    const second = await estimator.estimate(p, p, options);
    expect(route).toHaveBeenCalledTimes(2);
    if (!('bookingFare' in first) || !('bookingFare' in second)) throw Error('Missing quote');
    expect(first.bookingFare?.distanceAmount).toBe(10000);
    expect(second.bookingFare?.distanceAmount).toBe(14000);
    expect(second.bookingFare?.vehicleConfiguration?.version).toBe(2);
  });
});
