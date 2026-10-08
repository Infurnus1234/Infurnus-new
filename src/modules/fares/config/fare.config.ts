import type { FarePricingConfig, VehiclePricing } from '../types/fare.js';

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

export const VEHICLE_UNAVAILABLE_MESSAGE =
  'We’re sorry, but this vehicle is not available for booking yet. We’ll be introducing it soon. Please check back later.';
export const FIXED_QUOTE_REQUIRED_MESSAGE =
  'An approved fixed quote is required before booking this vehicle.';
export const VEHICLE_PRICING_VERSION = 'vehicle-ranges-v1';

// The existing fleet identifier `mini` is retained for Mini Cab. New goods
// identifiers describe the supplied categories; fleet records are not rewritten.
// A fixedRates entry may only be added after an explicit business pricing decision.
export const VEHICLE_FARE_PRICING: Readonly<
  Record<string, Readonly<Record<string, VehiclePricing>>>
> = {
  passenger: {
    bike: {
      displayName: 'Bike',
      baseFare: { minimum: 1500, maximum: 2000 },
      perKmRate: { minimum: 500, maximum: 800 },
    },
    auto: {
      displayName: 'Auto',
      baseFare: { minimum: 2000, maximum: 2500 },
      perKmRate: { minimum: 800, maximum: 1100 },
    },
    mini: {
      displayName: 'Mini Cab',
      baseFare: { minimum: 4000, maximum: 8000 },
      perKmRate: { minimum: 900, maximum: 1100 },
    },
    sedan: {
      displayName: 'Sedan',
      baseFare: { minimum: 6500, maximum: 10000 },
      perKmRate: { minimum: 1200, maximum: 1500 },
    },
    suv: {
      displayName: 'SUV',
      baseFare: { minimum: 9000, maximum: 12000 },
      perKmRate: { minimum: 1600, maximum: 2200 },
    },
  },
  logistics: {
    three_wheeler: {
      displayName: '3-Wheeler (Goods)',
      baseFare: { minimum: 20000, maximum: 20000 },
      perKmRate: { minimum: 1500, maximum: 2000 },
    },
    mini_truck: {
      displayName: 'Mini Truck (Tata Ace)',
      baseFare: { minimum: 23500, maximum: 32500 },
      perKmRate: { minimum: 1800, maximum: 2200 },
    },
    pickup_8ft: {
      displayName: 'Pickup 8ft',
      baseFare: { minimum: 32500, maximum: 37500 },
      perKmRate: { minimum: 2000, maximum: 2500 },
    },
    tata_407: {
      displayName: 'Tata 407',
      baseFare: { minimum: 77500, maximum: null },
      perKmRate: { minimum: 2500, maximum: 3000 },
    },
    ftl: {
      displayName: 'FTL (Intercity, per truck size)',
      baseFare: null,
      perKmRate: { minimum: 2600, maximum: 9100 },
      routeBased: true,
    },
  },
};

// Pricing aliases only: preserve the supplied fleet category in requests/bookings.
export const VEHICLE_PRICING_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  passenger: { mini_cab: 'mini' },
  logistics: {},
};

/** Only declared aliases are valid; arbitrary dynamic codes never read Object.prototype. */
export function canonicalVehicleCode(sector: string, code: string): string {
  const aliases = Object.hasOwn(VEHICLE_PRICING_ALIASES, sector)
    ? VEHICLE_PRICING_ALIASES[sector]
    : undefined;
  return aliases && Object.hasOwn(aliases, code) ? aliases[code]! : code;
}

// Compatibility identifiers from the existing sector tariff; new codes use the catalog.
export const LEGACY_SERVICE_CATEGORIES = [
  'ambulance',
  'towing',
  'towing_van',
  'jcb',
  'recovery',
  'recovery_vehicle',
  'roadside_service',
  'roadside_service_vehicle',
  'roadside_recovery',
  'roadside',
] as const;
export const LEGACY_PREMIUM_CATEGORIES = [
  'fortuner',
  'thar',
  'sedan',
  'suv',
  'mini',
  'luxury',
] as const;
