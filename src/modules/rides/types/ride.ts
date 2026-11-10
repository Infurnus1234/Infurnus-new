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

export interface RideBillingItemization {
  currency: string;
  hourlyRate?: number;
  bookedHours?: number;
  hourlyBase?: number;
  fuelRatePerKm?: number;
  actualDistanceKm?: number;
  actualDistanceMeters?: number;
  actualFuelCost?: number;
  baseAmount?: number;
  distanceAmount?: number;
  timeAmount?: number;
  subtotal?: number;
  taxAmount?: number;
  finalFare: number;
}

export type LogisticsPaymentStatus = 'NOT_REQUIRED' | 'PENDING' | 'PAID_VERIFIED' | 'FAILED';

export interface LogisticsPaymentDetails {
  totalFare: number;
  upfrontAmount: number;
  remainingAmount: number;
  status: LogisticsPaymentStatus;
  paidAt?: string | null;
  paymentId?: string | null;
}

export interface Ride {
  id: string;
  bookingId?: string | null;
  bookingIdExpiresAt?: Date | null;
  callingNumber?: string;
  customerId: string;
  assignedDriverId: string | null;
  assignedVehicleId: string | null;
  pickup: RideLocation;
  destination: RideLocation;
  pickupAddress: string | null;
  destinationAddress: string | null;
  status: RideStatus;
  dispatchExpiresAt?: Date | null;
  destinationDistrict?: string | null;
  /** Internal lookup metadata; excluded from Driver serialization. */
  destinationDistrictLookup?: import('../services/logistics-destination.js').DistrictLookup | null;
  bookingDistanceMeters?: number | null;
  bookingDurationSeconds?: number | null;
  vehicleName?: string | null;
  bookingPricingVersion?: string | null;
  bookingVehicleTypeId?: string | null;
  fareEstimate?: number | null;
  finalFare?: number | null;
  commissionAmount?: number | null;
  driverEarningAmount?: number | null;
  paymentStatus?: string | null;
  upfrontPaymentStatus?: LogisticsPaymentStatus | null;
  logisticsPayment?: LogisticsPaymentDetails | Record<string, unknown> | null;
  actualDistanceMeters?: number | null;
  actualFuelCost?: number | null;
  sector?: string | null;
  vehicleCategory?: string | null;
  goods?: Record<string, unknown> | null;
  serviceDetails?: Record<string, unknown> | null;
  rentalDetails?: Record<string, unknown> | null;
  pin?: string | null;
  pinVerified?: boolean;
  driverDetails?: RideDriverDetails | null;
  vehicleDetails?: RideVehicleDetails | null;
  cancellationReason: string | null;
  cancelledByCustomer?: boolean;
  driverAcceptedAt?: Date | null;
  customerCancellationDeadline?: Date | null;
  cancellationServerTime?: Date;
  customerCancellationAllowed?: boolean;
  cancelledAt: Date | null;
  completedAt: Date | null;
  billing?: RideBillingItemization | null;
  createdAt: Date;
  updatedAt: Date;
}
