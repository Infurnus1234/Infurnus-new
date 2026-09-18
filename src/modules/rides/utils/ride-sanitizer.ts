import type { Ride } from '../types/ride.js';

export type DriverSafeRide = Omit<Ride, 'fareEstimate' | 'finalFare' | 'actualFuelCost' | 'billing'>;

export function sanitizeRideForDriver(ride: Ride): DriverSafeRide {
  const {
    fareEstimate: _fareEstimate,
    finalFare: _finalFare,
    actualFuelCost: _actualFuelCost,
    billing: _billing,
    ...driverSafe
  } = ride;
  return driverSafe;
}
