import type { Ride } from '../types/ride.js';

export type DriverSafeRide = Omit<
  Ride,
  'fareEstimate' | 'finalFare' | 'actualFuelCost' | 'billing' | 'pin'
>;

export function sanitizeRideForDriver(ride: Ride): DriverSafeRide {
  const {
    fareEstimate: _fareEstimate,
    finalFare: _finalFare,
    actualFuelCost: _actualFuelCost,
    billing: _billing,
    pin: _pin,
    ...driverSafe
  } = ride;
  return driverSafe;
}
