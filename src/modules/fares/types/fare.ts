/**
 * Fare domain types.
 *
 * Current pricing model:
 *   Gross Fare = Base Fare + Distance Fare + Time Fare
 *
 * This is intentionally a simple v1 pricing model.
 * Coupons, taxes, surge, payment fees, vehicle-category pricing,
 * and other pricing adjustments will be added in later phases.
 */

export const FARE_CURRENCY = "INR" as const;

export type FareCurrency = typeof FARE_CURRENCY;

/**
 * Input required by the fare calculation engine.
 *
 * distanceMeters and durationSeconds should come from the
 * already-calculated route.
 */
export interface FareCalculationInput {
  distanceMeters: number;
  durationSeconds: number;
  currency?: FareCurrency;
}

/**
 * Monetary components of a calculated fare.
 *
 * All amounts are represented as integer minor units (paise)
 * to avoid floating-point money calculations.
 *
 * Example:
 *   1250 = ₹12.50
 */
export interface FareBreakdown {
  baseAmount: number;
  distanceAmount: number;
  timeAmount: number;
  grossAmount: number;
}

/**
 * Complete fare calculation result.
 *
 * pricingVersion makes the calculation reproducible and allows
 * future pricing-model changes without ambiguity.
 */
export interface FareCalculationResult extends FareBreakdown {
  distanceMeters: number;
  durationSeconds: number;
  currency: FareCurrency;
  pricingVersion: string;
}

/**
 * Configuration used by the v1 fare engine.
 *
 * Rates are represented in paise.
 *
 * distanceRatePerKm:
 *   Fare charged per kilometer.
 *
 * timeRatePerMinute:
 *   Fare charged per minute.
 */
export interface FarePricingConfig {
  baseFare: number;
  distanceRatePerKm: number;
  timeRatePerMinute: number;
  currency: FareCurrency;
  pricingVersion: string;
}