import type { Ride, RideLocation } from './ride.js';
import type { RouteMetadata } from '../repositories/ride.repository.js';
import type { RouteResult } from '../providers/map.provider.js';

export interface LiveRideLocation extends RideLocation {
  timestamp: string;
}
export interface RideMapSnapshot {
  ride: Ride;
  driverLocation: LiveRideLocation | null;
  userLocation: LiveRideLocation | null;
  metadata: RouteMetadata | null;
}
export interface RideInformation {
  fare: {
    currency: 'INR';
    bookedAmount: number | null;
    finalAmount: number | null;
    amount: number | null;
    authority: 'booked' | 'final' | 'unavailable';
  };
  totalDistance: {
    meters: number | null;
    source: 'booking' | 'geographic_estimate' | 'unavailable';
  };
  pickup: RideLocation & { address: string | null };
  drop: RideLocation & { address: string | null };
  rideType: string;
  vehicleCategory: string | null;
  rideStatus: Ride['status'];
}
export interface RideMapData extends RideInformation {
  rideId: string;
  driverLocation: LiveRideLocation | null;
  userLocation: LiveRideLocation | null;
  pickupDistance: { meters: number; source: 'geographic' } | null;
  pickupEta: { seconds: number; source: 'provider_route' | 'route_progress_estimate' } | null;
  route: RouteResult | null;
  routeStatus: 'available' | 'not_requested' | 'unavailable' | 'inactive';
  segment: 'pickup' | 'destination' | null;
  progress: { remainingFraction: number; deviationMeters: number } | null;
  eta: { seconds: number; source: 'provider_route' | 'route_progress_estimate' } | null;
  routeVersion: number;
  updatedAt: string;
  driverLocationFresh: boolean;
}
export interface UserRideMapData extends RideMapData {
  view: 'user';
}
export interface DriverRideMapData extends RideMapData {
  view: 'driver';
}
