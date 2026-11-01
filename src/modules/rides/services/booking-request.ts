import { createHash } from 'node:crypto';
import type { CreateRideInput } from '../schemas/ride.schemas.js';

/** Stable semantic identity. Quotes may refresh; the service intent may not change. */
export function bookingRequestFingerprint(input: CreateRideInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.sector,
        input.vehicleCategory,
        input.pickup.latitude,
        input.pickup.longitude,
        input.destination.latitude,
        input.destination.longitude,
        input.serviceDetails?.serviceType ?? null,
        input.serviceDetails?.emergencyLevel ?? null,
        input.serviceDetails?.description ?? null,
        input.serviceDetails?.notes ?? null,
      ]),
    )
    .digest('hex');
}
