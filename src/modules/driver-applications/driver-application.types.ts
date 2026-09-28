export const DRIVER_APPLICATION_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type DriverApplicationStatus = (typeof DRIVER_APPLICATION_STATUSES)[number];

export const VEHICLE_OWNERSHIP_TYPES = ['PARTNER_OWNED', 'DRIVER_ONLY'] as const;

export type VehicleOwnershipType = (typeof VEHICLE_OWNERSHIP_TYPES)[number];

export const DRIVER_APPLICATION_SECTORS = [
  'passenger',
  'logistics',
  'service',
  'premium',
  'rental',
] as const;

export type DriverApplicationSector = (typeof DRIVER_APPLICATION_SECTORS)[number];

export interface DriverApplication {
  id: string;

  partnerId: string;
  driverProfileId: string;

  requestedSector: DriverApplicationSector;
  requestedVehicleCategory: string;

  vehicleOwnershipType: VehicleOwnershipType;

  status: DriverApplicationStatus;

  submittedAt: Date | null;

  reviewedAt: Date | null;
  reviewedBy: string | null;

  reviewReason: string | null;

  approvedAt: Date | null;
  approvedBy: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDriverApplicationInput {
  partnerId: string;
  driverProfileId: string;

  requestedSector: DriverApplicationSector;
  requestedVehicleCategory: string;

  vehicleOwnershipType: VehicleOwnershipType;
}

export interface UpdateDriverApplicationStatusInput {
  status: DriverApplicationStatus;
  reviewReason?: string;
}

export interface ReviewDriverApplicationInput {
  status: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

  reviewReason?: string;
}

export interface DriverApplicationFilters {
  status?: DriverApplicationStatus;
  requestedSector?: DriverApplicationSector;
  requestedVehicleCategory?: string;
  vehicleOwnershipType?: VehicleOwnershipType;
  partnerId?: string;
  driverProfileId?: string;
  reviewedBy?: string;
  approvedBy?: string;
  page?: number;
  limit?: number;
}

export interface DriverApplicationListResult {
  items: DriverApplication[];
  total: number;
  page: number;
  limit: number;
}
