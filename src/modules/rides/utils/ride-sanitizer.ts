import { rideInformation, driverDestinationAllowed } from './ride-map-mapper.js';
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
    ...driverSafe
  } = ride;
  const reveal = driverDestinationAllowed(ride);
  return {
    ...driverSafe,
    serverTime: new Date().toISOString(),
    destination: reveal ? destination : null,
    destinationAddress: reveal ? destinationAddress : null,
    goods: reveal ? (ride.goods ?? null) : null,
    serviceDetails: reveal ? (ride.serviceDetails ?? null) : null,
    rentalDetails: reveal ? (ride.rentalDetails ?? null) : null,
    rideInformation: rideInformation(ride, reveal),
  };
}
