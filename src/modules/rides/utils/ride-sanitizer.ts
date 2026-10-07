import { rideInformation } from './ride-map-mapper.js';
import type { RideInformation } from '../types/ride-map.js';
import type { Ride } from '../types/ride.js';

export type DriverSafeRide = Omit<
  Ride,
  'fareEstimate' | 'finalFare' | 'actualFuelCost' | 'billing' | 'pin'
> & { rideInformation: RideInformation };

export function sanitizeRideForDriver(ride: Ride): DriverSafeRide {
  const {
    fareEstimate: _fareEstimate,
    finalFare: _finalFare,
    actualFuelCost: _actualFuelCost,
    billing: _billing,
    pin: _pin,
    ...driverSafe
  } = ride;
  return { ...driverSafe, rideInformation: rideInformation(ride) };
}
