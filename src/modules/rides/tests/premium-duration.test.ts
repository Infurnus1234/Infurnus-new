import { describe, expect, it } from 'vitest';
import { requestedBookingHours, hourlyBaseFare } from '../../vehicles/services/hourly-pricing.js';
import { createRideSchema, fareEstimateSchema } from '../schemas/ride.schemas.js';
const base = {
  sector: 'premium' as const,
  vehicleCategory: 'sedan',
  pickup: { latitude: 25.6, longitude: 85.1 },
  destination: { latitude: 26.6, longitude: 85.1 },
};
describe('Premium whole-hour contract', () => {
  it.each(Array.from({ length: 24 }, (_, i) => i + 1))(
    'preserves exactly %s hours and configured pricing',
    (hours) => {
      expect(
        createRideSchema.parse({ ...base, bookingHours: hours, rentalDetails: { hours } })
          .bookingHours,
      ).toBe(hours);
      expect(fareEstimateSchema.parse({ ...base, bookingHours: hours }).bookingHours).toBe(hours);
      expect(requestedBookingHours({ ...base, bookingHours: hours })).toBe(hours);
      const fares = Object.fromEntries(
        [...Array.from({ length: 12 }, (_, i) => String(i + 1)), '12_plus'].map((key, i) => [
          key,
          100 + i,
        ]),
      );
      const result = hourlyBaseFare(
        {
          sector: 'premium',
          baseFare: 10,
          hourlyBaseFares: fares,
          missingDurationPolicy: 'require_duration',
          extendedDurationPolicy: 'booked_duration',
        },
        hours,
      );
      expect(result).toMatchObject({
        bookedHours: hours,
        durationBucket: hours > 12 ? '12_plus' : String(hours),
        amountPaise: fares[hours > 12 ? '12_plus' : String(hours)]! * 100,
      });
    },
  );
  it.each([undefined, 0, -1, 1.5, 24.5, 25, 100])(
    'rejects invalid duration %s at both HTTP boundaries',
    (hours) => {
      for (const schema of [createRideSchema, fareEstimateSchema])
        expect(() =>
          requestedBookingHours(schema.parse({ ...base, bookingHours: hours })),
        ).toThrow();
    },
  );
  it('rejects conflicting duration aliases', () =>
    expect(() =>
      requestedBookingHours({ sector: 'premium', bookingHours: 18, rentalDetails: { hours: 24 } }),
    ).toThrow());
});
