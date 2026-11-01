import { env } from '../../../config/env.js';
export interface DispatchPolicy {
  kind: 'normal' | 'logistics' | 'towing' | 'premium' | 'ambulance' | 'legacy';
  radiiMeters: readonly number[];
  responseMs: number;
  cityWide: boolean;
  rankByDistance: boolean;
}
// Existing public sector/category identifiers are retained. No pricing rules change.
export function dispatchPolicy(sector = 'passenger', category = ''): DispatchPolicy {
  if (sector === 'premium')
    return {
      kind: 'premium',
      radiiMeters: [],
      responseMs: 3600000,
      cityWide: true,
      rankByDistance: false,
    };
  if (sector === 'logistics')
    return {
      kind: 'logistics',
      radiiMeters: [7000, 15000, 20000],
      responseMs: 120000,
      cityWide: false,
      rankByDistance: false,
    };
  if (sector === 'service')
    return {
      kind:
        category === 'ambulance'
          ? 'ambulance'
          : ['towing', 'towing_van'].includes(category)
            ? 'towing'
            : 'legacy',
      // The repository resolves the active Admin radius for every query/offer/accept.
      radiiMeters: [25000],
      responseMs: category === 'ambulance' ? 30000 : 600000,
      cityWide: false,
      rankByDistance: category === 'ambulance',
    };
  if (sector === 'passenger')
    return {
      kind: 'normal',
      radiiMeters: [2000, 5000, 10000],
      responseMs: 25000,
      cityWide: false,
      rankByDistance: false,
    };
  // Unspecified service categories retain their existing configuration. This is not
  // a new policy for unspecified service categories.
  return {
    kind: 'legacy',
    radiiMeters: env.MAP_DRIVER_RADII_METERS,
    responseMs: env.DRIVER_DISPATCH_RESPONSE_TIMEOUT_MS,
    cityWide: false,
    rankByDistance: false,
  };
}
