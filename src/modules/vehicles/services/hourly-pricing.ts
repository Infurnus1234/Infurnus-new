import { AppError } from '../../../common/errors/app-error.js';
import type { VehicleType } from '../types/vehicle.js';

export const HOURLY_FARE_BUCKETS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '12_plus',
] as const;
export type HourlyFareBucket = (typeof HOURLY_FARE_BUCKETS)[number];

/** Legacy aliases may coexist, but cannot describe different booking durations. */
export function requestedBookingHours(input: {
  sector?: string | undefined;
  bookingHours?: number | undefined;
  rentalHours?: number | undefined;
  rentalDetails?: { hours?: unknown; rentalHours?: unknown } | null | undefined;
}): number | undefined {
  if (!['passenger', 'premium', 'rental'].includes(input.sector ?? '')) return undefined;
  const aliases =
    input.sector === 'premium' || input.sector === 'rental'
      ? [input.rentalHours, input.rentalDetails?.hours, input.rentalDetails?.rentalHours]
      : [];
  const values = [input.bookingHours, ...aliases]
    .filter((value) => value !== undefined)
    .map(Number);
  if (values.some((value) => !Number.isFinite(value) || value <= 0))
    throw new AppError('FARE_DURATION_INVALID', 'Select a valid booking duration', 422);
  if (new Set(values).size > 1)
    throw new AppError('FARE_DURATION_CONFLICT', 'Booking duration fields must agree', 422);
  if (input.sector === 'rental' && !Number.isSafeInteger(values[0]))
    throw new AppError('FARE_DURATION_REQUIRED', 'Select a whole-hour rental duration', 422);
  return values[0];
}

export function hourlyPricingFromRow(
  row: Record<string, unknown>,
): Pick<VehicleType, 'hourlyBaseFares' | 'missingDurationPolicy' | 'extendedDurationPolicy'> {
  const fares = row.hourly_base_fares_paise as Record<string, number> | null | undefined;
  return {
    hourlyBaseFares:
      fares == null
        ? null
        : Object.fromEntries(
            Object.entries(fares).map(([key, value]) => [key, Number(value) / 100]),
          ),
    missingDurationPolicy:
      row.hourly_missing_duration_policy === 'require_duration'
        ? 'require_duration'
        : 'legacy_base',
    extendedDurationPolicy:
      row.extended_duration_policy === 'booked_duration' ? 'booked_duration' : null,
  };
}

/** Select a saved price; never derive one duration's price from another. */
export function hourlyBaseFare(
  type: Pick<
    VehicleType,
    'sector' | 'baseFare' | 'hourlyBaseFares' | 'missingDurationPolicy' | 'extendedDurationPolicy'
  >,
  hours?: number,
): {
  amountPaise: number;
  durationBucket?: HourlyFareBucket;
  bookedHours?: number;
} | null {
  if (type.hourlyBaseFares == null) return null;
  if (!['passenger', 'premium'].includes(type.sector))
    throw new AppError(
      'FARE_CONFIGURATION_MISSING',
      'Hourly pricing is unavailable for this sector',
      422,
    );
  if (!HOURLY_FARE_BUCKETS.every((key) => Object.hasOwn(type.hourlyBaseFares!, key)))
    throw new AppError(
      'FARE_CONFIGURATION_MISSING',
      'Complete this vehicle’s hourly pricing before booking',
      422,
    );
  if (hours === undefined)
    throw new AppError('FARE_DURATION_REQUIRED', 'Select a booking duration for this vehicle', 422);
  if (!Number.isSafeInteger(hours) || hours <= 0)
    throw new AppError(
      'FARE_DURATION_INVALID',
      'Booking duration must be a positive whole number of hours',
      422,
    );
  if (hours > 12 && type.extendedDurationPolicy !== 'booked_duration')
    throw new AppError(
      'FARE_EXTENDED_DURATION_UNCONFIGURED',
      'Extended-duration billing requires an approved policy',
      422,
    );
  const durationBucket: HourlyFareBucket =
    hours > 12 ? '12_plus' : (String(hours) as HourlyFareBucket);
  const amount = type.hourlyBaseFares[durationBucket];
  const amountPaise = Math.round(Number(amount) * 100);
  if (amount === undefined || !Number.isSafeInteger(amountPaise) || amountPaise < 0)
    throw new AppError('FARE_CONFIGURATION_MISSING', 'This duration has no valid saved fare', 422);
  return { amountPaise, durationBucket, bookedHours: hours };
}
