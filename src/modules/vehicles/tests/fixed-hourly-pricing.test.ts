import { describe, expect, it } from 'vitest';
import { FareCalculatorService } from '../../fares/services/fare-calculator.service.js';
import type { VehicleType } from '../types/vehicle.js';

const calculator = new FareCalculatorService();
const vehicle: VehicleType = {
  id: 'premium-test',
  name: 'Premium Test',
  code: 'test_car',
  sector: 'premium',
  active: true,
  version: 1,
  currency: 'INR',
  baseFare: 75,
  perKmRate: 25,
  fixedHourlyPricing: { hourlyRate: 500, fuelRate: 200, fuelUnit: 'per_booking' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const route = { distanceMeters: 12_345, durationSeconds: 600, vehicleCategory: vehicle.code };

describe.each(['premium', 'rental'] as const)('%s fixed hourly fare', (sector) => {
  const type = { ...vehicle, sector: sector === 'rental' ? ('passenger' as const) : sector };
  it.each([1, 2, 3, 4, 6, 12, 13, 24])('multiplies the saved rate by %i hours', (bookingHours) => {
    const fare = calculator.calculateEstimate(
      { ...route, sector, bookingHours, fuelRatePerKm: 9999 },
      type,
    );
    expect(fare).toMatchObject({
      bookable: true,
      vehicleCategory: type.code,
      bookingFare: {
        baseAmount: 50_000 * bookingHours,
        fuelAmount: 20_000,
        distanceAmount: 0,
        timeAmount: 0,
        grossAmount: 50_000 * bookingHours + 20_000,
        vehicleConfiguration: {
          id: type.id,
          bookedHours: bookingHours,
          pricingModel: 'fixed_hourly',
        },
      },
    });
  });

  it('charges fuel per hour and rounds the payable total once', () => {
    const fare = calculator.calculateEstimate(
      { ...route, sector, bookingHours: 3 },
      {
        ...type,
        fixedHourlyPricing: { hourlyRate: 100.07, fuelRate: 0.1, fuelUnit: 'per_hour' },
      },
    );
    expect(fare).toMatchObject({
      bookingFare: { baseAmount: 30_021, fuelAmount: 30, grossAmount: 30_100 },
    });
  });

  it('rejects missing, invalid, and cross-category configurations', () => {
    const input = { ...route, sector, bookingHours: 3 };
    expect(() => calculator.calculateEstimate(input, { ...type, code: 'other' })).toThrow(
      expect.objectContaining({ code: 'FARE_CONFIGURATION_MISSING' }),
    );
    const { fixedHourlyPricing: _pricing, ...legacyType } = type;
    expect(() => calculator.calculateEstimate(input, legacyType)).toThrow(
      expect.objectContaining({ code: 'FARE_CONFIGURATION_MISSING' }),
    );
    expect(() =>
      calculator.calculateEstimate(input, {
        ...type,
        fixedHourlyPricing: { hourlyRate: -1, fuelRate: 0, fuelUnit: 'per_booking' },
      }),
    ).toThrow(expect.objectContaining({ code: 'FARE_CONFIGURATION_MISSING' }));
  });
});

it('preserves duration policies and only charges configured kilometre fuel on the billable distance', () => {
  const type = {
    ...vehicle,
    fixedHourlyPricing: { hourlyRate: 400, fuelRate: 12.34, fuelUnit: 'per_km' as const },
  };
  const premium = { ...route, sector: 'premium' as const };
  expect(() => calculator.calculateEstimate({ ...premium, bookingHours: 25 }, type)).toThrow(
    expect.objectContaining({ code: 'FARE_DURATION_INVALID' }),
  );
  expect(
    calculator.calculateEstimate({ ...premium, rentalHours: 6, tripType: 'one_way' }, type),
  ).toMatchObject({ bookingFare: { fuelAmount: 15_234, grossAmount: 255_200 } });
  expect(
    calculator.calculateEstimate({ ...premium, bookingHours: 6, tripType: 'round_trip' }, type),
  ).toMatchObject({ bookingFare: { fuelAmount: 30_467, grossAmount: 270_500 } });
  expect(
    calculator.calculateEstimate(
      { ...route, sector: 'rental', bookingHours: 25 },
      {
        ...type,
        sector: 'passenger',
        fixedHourlyPricing: { hourlyRate: 120, fuelRate: 0, fuelUnit: 'per_hour' },
      },
    ),
  ).toMatchObject({ bookingFare: { fuelAmount: 0, grossAmount: 300_000 } });
});

it('rejects a total that would overflow the stored fare after whole-rupee rounding', () => {
  expect(() =>
    calculator.calculateEstimate(
      { ...route, sector: 'premium', bookingHours: 1 },
      {
        ...vehicle,
        fixedHourlyPricing: { hourlyRate: 99_999_999.99, fuelRate: 0, fuelUnit: 'per_booking' },
      },
    ),
  ).toThrow(expect.objectContaining({ code: 'FARE_AMOUNT_UNSUPPORTED' }));
});
