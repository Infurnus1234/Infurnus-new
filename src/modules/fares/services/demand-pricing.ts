import { AppError } from '../../../common/errors/app-error.js';
import type {
  DemandPricingSettings,
  DemandPricingProvenance,
  VehiclePricing,
} from '../types/fare.js';

export interface BookingDemandSample {
  count: number;
  measuredAt: string;
}
export function validateDemandSettings(s: DemandPricingSettings): void {
  if (
    !s ||
    ![s.windowSeconds, s.lowBookingCount, s.highBookingCount, s.staleAfterSeconds].every(
      Number.isSafeInteger,
    ) ||
    s.windowSeconds < 1 ||
    s.windowSeconds > 86400 ||
    s.lowBookingCount < 0 ||
    s.highBookingCount <= s.lowBookingCount ||
    s.staleAfterSeconds < 1 ||
    s.staleAfterSeconds > s.windowSeconds
  )
    throw new AppError('FARE_PRICING_INVALID', 'Invalid booking-demand settings', 503);
}
export function demandProvenance(
  s: DemandPricingSettings,
  sample?: BookingDemandSample | null,
  now = Date.now(),
): DemandPricingProvenance {
  validateDemandSettings(s);
  const age = sample ? now - Date.parse(sample.measuredAt) : NaN;
  const valid =
    sample &&
    Number.isSafeInteger(sample.count) &&
    sample.count >= 0 &&
    Number.isFinite(age) &&
    age >= -1000 &&
    age <= s.staleAfterSeconds * 1000;
  if (!valid)
    return {
      scoreBasisPoints: 0,
      source: 'minimum_fallback',
      measuredAt: null,
      bookingCount: null,
      windowSeconds: s.windowSeconds,
      reason: 'Booking demand unavailable or stale',
    };
  return {
    scoreBasisPoints: clampDemandScore(
      (sample.count - s.lowBookingCount) / (s.highBookingCount - s.lowBookingCount),
    ),
    source: 'booking_window',
    measuredAt: sample.measuredAt,
    bookingCount: sample.count,
    windowSeconds: s.windowSeconds,
  };
}
export function clampDemandScore(score: number): number {
  return Number.isFinite(score) ? Math.round(Math.max(0, Math.min(1, score)) * 10000) : 0;
}
export function interpolatePaise(
  minimum: number,
  maximum: number | null,
  scoreBasisPoints: number,
): number {
  if (
    !Number.isSafeInteger(minimum) ||
    minimum < 0 ||
    (maximum !== null && (!Number.isSafeInteger(maximum) || maximum < minimum)) ||
    !Number.isInteger(scoreBasisPoints) ||
    scoreBasisPoints < 0 ||
    scoreBasisPoints > 10000
  )
    throw new AppError('FARE_PRICING_INVALID', 'Invalid demand pricing range', 503);
  // An unspecified maximum (Tata 407) never authorizes an invented higher base.
  const upper = maximum ?? minimum;
  return Number(
    BigInt(minimum) + (BigInt(upper - minimum) * BigInt(scoreBasisPoints) + 5000n) / 10000n,
  );
}
export function selectDemandRates(pricing: VehiclePricing, provenance: DemandPricingProvenance) {
  if (!pricing.baseFare || pricing.routeBased)
    throw new AppError('FARE_FIXED_QUOTE_REQUIRED', 'An approved route quote is required', 422);
  return {
    baseFare: interpolatePaise(
      pricing.baseFare.minimum,
      pricing.baseFare.maximum,
      provenance.scoreBasisPoints,
    ),
    distanceRatePerKm: interpolatePaise(
      pricing.perKmRate.minimum,
      pricing.perKmRate.maximum,
      provenance.scoreBasisPoints,
    ),
  };
}
