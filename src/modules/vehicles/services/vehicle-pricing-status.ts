import { serviceConfiguration } from './service-pricing.js';
import type { VehicleType } from '../types/vehicle.js';
import { vehiclePricingReferenceSchema } from '../schemas/vehicle.schemas.js';
import { HOURLY_FARE_BUCKETS } from './hourly-pricing.js';

/** Eligibility for the existing base/distance and saved-demand models. Inventory,
 * service area and dispatch eligibility are still enforced by their own gates. */
export function vehiclePricingStatus(type: VehicleType) {
  if (type.sector === 'service') {
    try {
      serviceConfiguration({ ...type, active: true });
    } catch {
      return 'needs_pricing' as const;
    }
    return type.active ? ('available' as const) : ('inactive' as const);
  }
  if (type.sector === 'logistics' && !type.logisticsSlabs) return 'needs_pricing' as const;
  if (
    type.hourlyBaseFares != null &&
    (!['passenger', 'premium'].includes(type.sector) ||
      !HOURLY_FARE_BUCKETS.every((key) => {
        const value = type.hourlyBaseFares![key];
        return typeof value === 'number' && Number.isFinite(value) && value >= 0;
      }))
  )
    return 'needs_pricing' as const;
  if (type.logisticsSlabs)
    return type.sector === 'logistics'
      ? type.active
        ? ('available' as const)
        : ('inactive' as const)
      : ('needs_pricing' as const);
  const scalar =
    type.baseFare !== null &&
    type.perKmRate !== null &&
    [type.baseFare, type.perKmRate].every((v) => Number.isFinite(v) && v >= 0);
  const reference =
    type.pricingReference && vehiclePricingReferenceSchema.safeParse(type.pricingReference).success;
  if ((!scalar && !reference) || (scalar && reference)) return 'needs_pricing' as const;
  if (!type.active) return 'inactive' as const;
  if (
    type.code === 'ftl' ||
    (!scalar &&
      (!type.pricingReference?.demandPricing ||
        type.pricingReference.routeBased ||
        !type.pricingReference.baseFare))
  )
    return 'quote_required' as const;
  return 'available' as const;
}
