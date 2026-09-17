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

export interface RideDriverDetails {
  id: string;
  name: string;
  phone?: string | null;
  rating?: number | null;
  photoUrl?: string | null;
}

export interface RideVehicleDetails {
  make: string;
  model: string;
  color?: string | null;
  plateNumber: string;
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
  fareEstimate?: number | null;
  sector?: string | null;
  vehicleCategory?: string | null;
  goods?: Record<string, unknown> | null;
  serviceDetails?: Record<string, unknown> | null;
  rentalDetails?: Record<string, unknown> | null;
  pin?: string | null;
  driverDetails?: RideDriverDetails | null;
  vehicleDetails?: RideVehicleDetails | null;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

