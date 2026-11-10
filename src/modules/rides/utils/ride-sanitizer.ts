import { privateBookingPayload } from './booking-contact.js';
import { env } from '../../../config/env.js';
import {
  rideInformation,
  driverDestinationAllowed,
  driverDestinationMarkerAllowed,
} from './ride-map-mapper.js';
import type { RideInformation } from '../types/ride-map.js';
import type { Ride } from '../types/ride.js';

export type DriverSafeRide = Omit<
  Ride,
  | 'fareEstimate'
  | 'finalFare'
  | 'actualFuelCost'
  | 'billing'
  | 'pin'
  | 'destination'
  | 'destinationAddress'
  | 'destinationDistrictLookup'
> & {
  destination: Ride['destination'] | null;
  destinationAddress: string | null;
  rideInformation: RideInformation;
  serverTime: string;
};

export function sanitizeRideForDriver(ride: Ride): DriverSafeRide {
  const {
    fareEstimate: _fareEstimate,
    finalFare: _finalFare,
    actualFuelCost: _actualFuelCost,
    billing: _billing,
    pin: _pin,
    destination,
    destinationAddress,
    destinationDistrictLookup: _districtLookup,
    ...driverSafe
  } = ride;
  const reveal = driverDestinationAllowed(ride);
  if (ride.sector === 'logistics' && !reveal) {
    // Fail closed for legacy projections as well as the typed repository model.
    for (const field of [
      'destinationLatitude',
      'destinationLongitude',
      'destinationPlaceId',
      'destinationLocation',
      'destinationReference',
      'drop',
      'dropLocation',
      'dropLatitude',
      'dropLongitude',
      'dropAddress',
      'route',
      'routeMetadata',
      'route_metadata',
      'navigation',
      'bookingFareSnapshot',
    ])
      delete (driverSafe as Record<string, unknown>)[field];
  }
  return {
    ...privateBookingPayload(driverSafe),
    callingNumber: env.INFURNUS_CALLING_NUMBER,
    serverTime: new Date().toISOString(),
    destination: reveal || driverDestinationMarkerAllowed(ride) ? destination : null,
    destinationAddress: reveal
      ? destinationAddress
      : ride.sector === 'logistics'
        ? (ride.destinationDistrict ?? null)
        : null,
    ...(ride.sector === 'logistics'
      ? {
          destinationDistrict: ride.destinationDistrict ?? null,
          destinationVisibility: reveal ? 'full' : 'district_only',
        }
      : {}),
    goods: reveal ? (ride.goods ?? null) : null,
    serviceDetails: reveal ? (ride.serviceDetails ?? null) : null,
    rentalDetails:
      ride.sector === 'rental'
        ? { hours: ride.rentalDetails?.hours ?? null }
        : reveal
          ? (ride.rentalDetails ?? null)
          : null,
    rideInformation: rideInformation(ride, reveal),
  };
}
