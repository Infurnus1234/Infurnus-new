export const rideStatuses = [
  'requested',
  'searching',
  'driver_assigned',
  'driver_arriving',
  'driver_arrived',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type RideStatus = (typeof rideStatuses)[number];

export interface RideLocation {
  latitude: number;
  longitude: number;
}

export interface Ride {
  id: string;
  customerId: string;
  assignedDriverId: string | null;
  assignedVehicleId: string | null;
  pickup: RideLocation;
  destination: RideLocation;
  pickupAddress: string | null;
  destinationAddress: string | null;
  status: RideStatus;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
