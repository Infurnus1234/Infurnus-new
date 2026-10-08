import type { Ride } from '../types/ride.js';
import type { RideInformation, LiveRideLocation } from '../types/ride-map.js';
import { geographicDistance, validateCoordinates } from '../../maps/geometry.js';
import { env } from '../../../config/env.js';

export const activeMapStatuses = [
  'driver_assigned',
  'driver_arriving',
  'driver_arrived',
  'in_progress',
];
export function freshRideLocation(location: LiveRideLocation | null, now = Date.now()) {
  if (!location) return null;
  try {
    validateCoordinates(location);
  } catch {
    return null;
  }
  const age = now - Date.parse(location.timestamp);
  return Number.isFinite(age) && age >= 0 && age <= env.DRIVER_LOCATION_STALE_SECONDS * 1000
    ? { latitude: location.latitude, longitude: location.longitude, timestamp: location.timestamp }
    : null;
}
export function rideInformation(ride: Ride): RideInformation {
  const amount = (n: number | null | undefined) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  const bookedAmount = amount(ride.fareEstimate),
    finalAmount = ride.status === 'completed' ? amount(ride.finalFare) : null;
  const bookingDistance = amount(ride.bookingDistanceMeters);
  let geographicEstimate: number | null = null;
  try {
    validateCoordinates(ride.pickup);
    validateCoordinates(ride.destination);
    geographicEstimate = Math.round(geographicDistance(ride.pickup, ride.destination));
  } catch {
    /* Unknown legacy distance is unavailable, never zero. */
  }
  return {
    fare: {
      currency: 'INR',
      bookedAmount,
      finalAmount,
      amount: finalAmount ?? bookedAmount,
      authority: finalAmount !== null ? 'final' : bookedAmount !== null ? 'booked' : 'unavailable',
    },
    totalDistance: {
      meters: bookingDistance ?? geographicEstimate,
      source:
        bookingDistance !== null
          ? 'booking'
          : geographicEstimate !== null
            ? 'geographic_estimate'
            : 'unavailable',
    },
    pickup: { ...ride.pickup, address: ride.pickupAddress },
    drop: { ...ride.destination, address: ride.destinationAddress },
    rideType: ride.sector ?? 'passenger',
    vehicleCategory: ride.vehicleCategory ?? null,
    rideStatus: ride.status,
  };
}
