export const driverAvailabilityStatuses = ['available', 'unavailable', 'busy', 'stale'] as const;

export type DriverAvailabilityStatus = (typeof driverAvailabilityStatuses)[number];

export interface DriverLocation {
  latitude: number;
  longitude: number;
  recordedAt: Date;
}

export interface DriverCandidate {
  driverProfileId: string;
  userId: string;
  vehicleId: string;
  distanceMeters: number;
  latitude: number;
  longitude: number;
  availabilityStatus: DriverAvailabilityStatus;
  verificationStatus: string;
  activeRideCount: number;
  locationRecordedAt: Date;
}

export interface DriverProfile {
  id: string;
  userId: string;
  licenseNumber: string;
  licenseExpiry: string;
  licenseDocumentKey?: string | null;
  vehicleRcDocumentKey?: string | null;
  profilePhotoKey?: string | null;
  verificationStatus: string;
  rejectionReason?: string | null;
  availabilityStatus?: DriverAvailabilityStatus | null;
  createdAt: Date;
  updatedAt: Date;
}
