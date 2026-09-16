import type { FarePricingConfig } from '../types/fare.js';

/**
 * INFURNUS Fare Pricing — v1
 *
 * Simple initial pricing model:
 *
 *   Gross Fare =
 *     Base Fare
 *     + Distance Fare
 *     + Time Fare
 *
 * All monetary values are stored/calculated in paise.
 *
 * These values are intentionally rough for the first version.
 * Pricing can be refined later without changing the fare domain API.
 */

export const DEFAULT_FARE_PRICING: Readonly<FarePricingConfig> = {
  baseFare: 500, // ₹5.00
  distanceRatePerKm: 1200, // ₹12.00 / km
  timeRatePerMinute: 200, // ₹2.00 / minute
  currency: 'INR',
  pricingVersion: 'v1',
};
