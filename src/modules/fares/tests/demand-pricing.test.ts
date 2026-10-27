import { describe, it, expect, vi } from 'vitest';
import {
  clampDemandScore,
  demandProvenance,
  interpolatePaise,
  selectDemandRates,
} from '../services/demand-pricing.js';
import { FareCalculatorService } from '../services/fare-calculator.service.js';
import { FareEstimateService } from '../services/fare-estimate.service.js';
import { VEHICLE_FARE_PRICING } from '../config/fare.config.js';
import type { VehicleType } from '../../vehicles/types/vehicle.js';
import type { VehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import type { MapProvider } from '../../rides/providers/map.provider.js';
const settings = {
  windowSeconds: 300,
  lowBookingCount: 5,
  highBookingCount: 20,
  staleAfterSeconds: 30,
};
const input = {
  distanceMeters: 1000,
  durationSeconds: 60,
  sector: 'passenger' as const,
  vehicleCategory: 'bike',
};
const vehicle = (
  sector = 'passenger',
  code = 'bike',
  pricing = VEHICLE_FARE_PRICING[sector]![code]!,
): VehicleType => ({
  id: 'test-type',
  name: pricing.displayName,
  sector: sector as VehicleType['sector'],
  code,
  baseFare: null,
  perKmRate: null,
  pricingReference: { ...pricing, demandPricing: settings },
  currency: 'INR',
  active: true,
  version: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const calc = new FareCalculatorService();
describe('validated booking-demand pricing', () => {
  it.each([
    ['passenger', 'bike', 1500, 2000, 500, 800],
    ['passenger', 'auto', 2000, 2500, 800, 1100],
    ['passenger', 'mini', 4000, 8000, 900, 1100],
    ['passenger', 'sedan', 6500, 10000, 1200, 1500],
    ['passenger', 'suv', 9000, 12000, 1600, 2200],
    ['logistics', 'three_wheeler', 20000, 20000, 1500, 2000],
    ['logistics', 'mini_truck', 23500, 32500, 1800, 2200],
    ['logistics', 'pickup_8ft', 32500, 37500, 2000, 2500],
    ['logistics', 'tata_407', 77500, null, 2500, 3000],
    ['logistics', 'ftl', null, null, 2600, 9100],
  ] as const)('matches approved chart exactly: %s/%s', (sector, code, bmin, bmax, rmin, rmax) => {
    expect(VEHICLE_FARE_PRICING[sector]![code]).toMatchObject({
      baseFare: bmin === null ? null : { minimum: bmin, maximum: bmax },
      perKmRate: { minimum: rmin, maximum: rmax },
    });
  });
  it.each([
    [-1, 0],
    [0, 0],
    [0.5, 5000],
    [1, 10000],
    [2, 10000],
    [NaN, 0],
  ])('clamps score %s', (score, expected) => expect(clampDemandScore(score)).toBe(expected));
  it.each([0, 5, 10, 20, 30])('measures window count %s', (count) => {
    const d = demandProvenance(settings, { count, measuredAt: new Date().toISOString() });
    expect(d.source).toBe('booking_window');
    expect(d.scoreBasisPoints).toBe(clampDemandScore((count - 5) / 15));
  });
  it.each([
    null,
    { count: 20, measuredAt: new Date(0).toISOString() },
    { count: -1, measuredAt: new Date().toISOString() },
  ])('falls back when missing or stale', (sample) =>
    expect(demandProvenance(settings, sample)).toMatchObject({
      scoreBasisPoints: 0,
      source: 'minimum_fallback',
    }),
  );
  it('uses exact integer monetary interpolation', () => {
    expect(interpolatePaise(1500, 2000, 5000)).toBe(1750);
    expect(interpolatePaise(77500, null, 10000)).toBe(77500);
    expect(() => interpolatePaise(100, 50, 5000)).toThrow();
  });
  it.each(
    Object.entries(VEHICLE_FARE_PRICING).flatMap(([sector, types]) =>
      Object.entries(types).map(([code, pricing]) => ({ sector, code, pricing })),
    ),
  )('honors all chart boundaries $sector/$code', ({ sector, code, pricing }) => {
    for (const score of [0, 5000, 10000]) {
      const d = { ...demandProvenance(settings), scoreBasisPoints: score };
      const r = calc.calculateEstimate(
        { ...input, sector: sector as 'passenger' | 'logistics', vehicleCategory: code },
        vehicle(sector, code, pricing),
        undefined,
        d,
      );
      if (!('estimateType' in r)) throw Error('Expected range contract');
      if (code === 'ftl') {
        expect(r).toMatchObject({ estimateType: 'quote_required', bookable: false });
        continue;
      }
      const rates = selectDemandRates(pricing, d);
      expect(r.bookingFare).toMatchObject({
        baseAmount: rates.baseFare,
        distanceAmount: 2 * rates.distanceRatePerKm,
        timeAmount: 0,
        grossAmount: rates.baseFare + 2 * rates.distanceRatePerKm,
        pricingVersion: 'vehicle-type:test-type:v7',
      });
      expect(r.bookingFare?.baseAmount).toBeGreaterThanOrEqual(pricing.baseFare!.minimum);
      if (pricing.baseFare!.maximum !== null)
        expect(r.bookingFare!.baseAmount).toBeLessThanOrEqual(pricing.baseFare!.maximum!);
    }
  });
  it('Bike is 25 / 30.50 / 36 INR for one-way 1 km at low/mid/high demand', () => {
    expect(
      [0, 5000, 10000].map((score) => {
        const r = calc.calculateEstimate(input, vehicle(), undefined, {
          ...demandProvenance(settings),
          scoreBasisPoints: score,
        });
        return 'bookingFare' in r ? r.bookingFare?.grossAmount : undefined;
      }),
    ).toEqual([2500, 3050, 3600]);
  });
  it('rejects inactive and cross-sector configurations', () => {
    expect(() => calc.calculateEstimate(input, { ...vehicle(), active: false })).toThrow();
    expect(() => calc.calculateEstimate(input, { ...vehicle(), sector: 'premium' })).toThrow();
  });
  it('rejects invalid thresholds', () =>
    expect(() => demandProvenance({ ...settings, highBookingCount: 5 })).toThrow());
  it('Scorpio N requires an explicitly saved approved tariff, not SUV fallback', async () => {
    const repo = { findTypeByCode: vi.fn(async () => null) } as unknown as VehicleRepository;
    const maps = { calculateRoute: vi.fn() } as unknown as MapProvider;
    await expect(
      new FareEstimateService(maps, calc, {}, repo).estimate(
        { latitude: 25, longitude: 85 },
        { latitude: 25.1, longitude: 85.1 },
        { sector: 'rental', vehicleCategory: 'scorpio_n', pricingMode: 'vehicle_range' },
      ),
    ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
    expect(maps.calculateRoute).not.toHaveBeenCalled();
    // Hypothetical explicitly approved tariff exists only in this isolated unit fixture.
    const approved = vehicle('rental', 'scorpio_n', {
      displayName: 'Scorpio N',
      baseFare: { minimum: 10000, maximum: 10000 },
      perKmRate: { minimum: 2000, maximum: 2000 },
    });
    expect(
      calc.calculateEstimate(
        { ...input, sector: 'rental', vehicleCategory: 'scorpio_n' },
        approved,
      ),
    ).toMatchObject({ bookable: true });
  });
  it('does not fall back to legacy service/premium or undeclared aliases with a repository', async () => {
    for (const [sector, code] of [
      ['service', 'bike'],
      ['premium', 'auto'],
      ['premium', 'bike'],
      ['passenger', 'hatchback'],
      ['rental', 'scorpio'],
    ]) {
      const estimator = new FareEstimateService({} as MapProvider, calc, {}, {
        findTypeByCode: async () => null,
      } as unknown as VehicleRepository);
      await expect(
        estimator.estimate(
          { latitude: 25, longitude: 85 },
          { latitude: 25, longitude: 85 },
          { sector: sector as 'service', vehicleCategory: code, pricingMode: 'vehicle_range' },
        ),
      ).rejects.toMatchObject({ code: 'FARE_CONFIGURATION_MISSING' });
    }
  });
  it('queries a measured signal and canonical aliases on the server', async () => {
    const repo = {
      findTypeByCode: vi.fn(async () => vehicle('passenger', 'mini')),
      measureBookingDemand: vi.fn(async () => ({
        count: 20,
        measuredAt: new Date().toISOString(),
      })),
    } as unknown as VehicleRepository;
    const estimator = new FareEstimateService(
      {
        calculateRoute: async () => ({ distanceMeters: 1000, durationSeconds: 60 }),
      } as unknown as MapProvider,
      calc,
      {},
      repo,
    );
    const r = await estimator.estimate(
      { latitude: 25, longitude: 85 },
      { latitude: 25, longitude: 85 },
      { sector: 'passenger', vehicleCategory: 'mini_cab', pricingMode: 'vehicle_range' },
    );
    expect(repo.findTypeByCode).toHaveBeenCalledWith('mini', 'passenger');
    expect(repo.measureBookingDemand).toHaveBeenCalledWith('passenger', ['mini', 'mini_cab'], 300);
    expect(r).toMatchObject({
      bookable: true,
      vehicleCategory: 'mini',
      demandPricing: { scoreBasisPoints: 10000, source: 'booking_window' },
    });
  });
});
