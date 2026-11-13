import type { RouteResult } from '../providers/map.provider.js';
import type { Ride } from '../types/ride.js';
import type {
  RideInformation,
  LiveRideLocation,
  RemainingRoadDistance,
} from '../types/ride-map.js';
import {
  decodePolyline,
  geographicDistance,
  routeProgress,
  validateCoordinates,
} from '../../maps/geometry.js';
import { env } from '../../../config/env.js';

export const activeMapStatuses = [
  'driver_assigned',
  'driver_arriving',
  'driver_arrived',
  'in_progress',
];
export function remainingRoadDistance(
  ride: Ride,
  location: LiveRideLocation | null,
  route: RouteResult | null | undefined,
  progress?: ReturnType<typeof routeProgress> | null,
): RemainingRoadDistance {
  const unavailable: RemainingRoadDistance = { meters: null, status: 'updating' };
  if (
    !location ||
    (location.latitude === 0 && location.longitude === 0) ||
    (ride.destination.latitude === 0 && ride.destination.longitude === 0)
  )
    return unavailable;
  const direct = geographicDistance(location, ride.destination);
  if (
    typeof location.accuracy === 'number' &&
    location.accuracy > 0 &&
    location.accuracy <= 100 &&
    direct <= Math.min(10, location.accuracy)
  )
    return { meters: 0, status: 'arrived' };
  const approximate: RemainingRoadDistance = {
    meters: Math.max(1, Math.round(direct)),
    status: 'approximate',
  };
  if (!route?.encodedPolyline || route.distanceMeters <= 0) return approximate;
  const projected = progress ?? routeProgress(location, decodePolyline(route.encodedPolyline));
  if (
    projected.deviationMeters > env.MAP_OFF_ROUTE_ENTER_METERS ||
    projected.remainingFraction <= 0
  )
    return approximate;
  return {
    meters: Math.max(1, Math.round(route.distanceMeters * projected.remainingFraction)),
    status: 'live',
  };
}

export function freshRideLocation(location: LiveRideLocation | null, now = Date.now()) {
  if (!location) return null;
  try {
    validateCoordinates(location);
  } catch {
    return null;
  }
  const age = now - Date.parse(location.timestamp);
  return Number.isFinite(age) && age >= 0 && age <= env.DRIVER_LOCATION_STALE_SECONDS * 1000
    ? { ...location }
    : null;
}
/** Coordinates for the assigned driver's destination pin; navigation remains PIN gated. */
export function driverDestinationMarkerAllowed(ride: Ride): boolean {
  return (
    !!ride.assignedDriverId &&
    activeMapStatuses.includes(ride.status) &&
    (ride.sector !== 'logistics' || driverDestinationAllowed(ride))
  );
}
export function driverDestinationAllowed(ride: Ride): boolean {
  return (
    !!ride.assignedDriverId &&
    ride.pinVerified === true &&
    ['in_progress', 'completed', 'cancelled'].includes(ride.status)
  );
}
export function rideInformation(ride: Ride, includeDestination = true): RideInformation {
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
    drop: includeDestination
      ? { ...ride.destination, address: ride.destinationAddress }
      : ride.sector === 'logistics'
        ? { address: ride.destinationDistrict ?? null }
        : null,
    rideType: ride.sector ?? 'passenger',
    vehicleCategory: ride.vehicleCategory ?? null,
    rideStatus: ride.status,
  };
}
