import type { VehicleFareSnapshot } from '../../vehicles/types/vehicle.js';
/**
 * Fare domain types.
 *
 * Current pricing model:
 *   Gross Fare = Base Fare + Distance Fare + Time Fare
 *
 * This is intentionally a simple v1 pricing model.
 * Legacy scalar callers retain this contract. Vehicle range estimates reuse
 * the same engine and preserve existing ancillary charges.
 */

export const FARE_CURRENCY = 'INR' as const;

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
  sector?: 'passenger' | 'logistics' | 'service' | 'premium' | undefined;
  vehicleCategory?: string | undefined;
  waitingMinutes?: number | undefined;
  weightKg?: number | undefined;
  hasLoadingAssistance?: boolean | undefined;
  rentalHours?: number | undefined;
  fuelRatePerKm?: number | undefined;
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
  waitingAmount?: number;
  weightAmount?: number;
  loadingAmount?: number;
  fuelAmount?: number;
  taxRate?: number;
  taxAmount?: number;
  commissionRate?: number;
  commissionAmount?: number;
  driverEarnings?: number;
  grossAmount: number;
}

/**
 * Complete fare calculation result.
 *
 * pricingVersion makes the calculation reproducible and allows
 * future pricing-model changes without ambiguity.
 */
export interface FareCalculationResult extends FareBreakdown {
  vehicleConfiguration?: VehicleFareSnapshot;
  distanceMeters: number;
  durationSeconds: number;
  currency: FareCurrency;
  pricingVersion: string;
  routeSource?: 'google_maps_road' | 'haversine_estimated';
  straightLineDistanceMeters?: number;
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

/** Original approximate rates, in paise. Null maximum means an open upper bound. */
export interface VehiclePricing {
  displayName: string;
  baseFare: { minimum: number; maximum: number | null } | null;
  perKmRate: { minimum: number; maximum: number };
  routeBased?: boolean;
  /** Explicit operational decision; never derived automatically from the range. */
  fixedRates?: { baseFare: number; distanceRatePerKm: number };
}

export interface VehicleFareEstimate {
  estimateType: 'range' | 'quote_required';
  vehicleCategory: string;
  pricing: VehiclePricing;
  currency: FareCurrency;
  pricingVersion: string;
  distanceMeters: number;
  durationSeconds: number;
  routeSource?: 'google_maps_road' | 'haversine_estimated';
  straightLineDistanceMeters?: number;
  estimatedFare?: { minimum: FareCalculationResult; maximum: FareCalculationResult | null };
  bookingFare?: FareCalculationResult;
  bookable: boolean;
  message: string;
  grossAmount?: never;
}

export type FareEstimateResult = FareCalculationResult | VehicleFareEstimate;
