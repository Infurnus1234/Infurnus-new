import type {
  PartnerApprovalStatus,
  PartnerAvailabilityStatus,
} from '../../partners/types/partner.js';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  role: string;
  status: string;
  createdAt: Date;
}

export interface AdminPartner {
  id: string;
  userId: string;
  businessName: string;
  businessDescription: string | null;
  approvalStatus: PartnerApprovalStatus;
  availabilityStatus: PartnerAvailabilityStatus;
  createdAt: Date;
  updatedAt: Date;
  kycStatus: string;
  aadhaarStatus: string;
  panStatus: string;
  drivingLicenceStatus: string;
  profilePhotoStatus: string;
  addressProofStatus: string;
  vehicleCount: number;
  vehicles: AdminPartnerVehicle[];
  drivers: AdminPartnerDriver[];
}

export interface AdminPartnerVehicle {
  id: string;
  plateNumber: string;
  isActive: boolean;
  insuranceStatus: string | null;
  permitStatus: string | null;
  fitnessStatus: string | null;
}

export interface AdminPartnerDriver {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  userStatus: string;
  verificationStatus: string;
  availabilityStatus: string | null;
  licenseNumber: string | null;
  licenseExpiry: Date | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
}

export interface AdminVehicle {
  id: string;
  driverProfileId: string;
  partnerId: string | null;
  make: string;
  model: string;
  plateNumber: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  insuranceStatus: string | null;
  permitStatus: string | null;
  fitnessStatus: string | null;
}

/**
 * Admin driver list item.
 *
 * Represents the current driver state, not driver application history.
 * Partner relationship comes from partner_drivers.
 * Vehicle relationship comes from driver_profiles.active_vehicle_id.
 */
export interface AdminDriver {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  userStatus: string;

  verificationStatus: string;
  availabilityStatus: string | null;

  licenseNumber: string | null;
  licenseExpiry: Date | null;

  city: string | null;
  state: string | null;
  pinCode: string | null;

  partner: {
    id: string;
    businessName: string;
  } | null;

  vehicle: {
    id: string;
    plateNumber: string;
    make: string;
    model: string;
    isActive: boolean;
  } | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Admin driver detail view.
 *
 * Represents the complete current driver state plus related
 * partner relationships, vehicles, documents, and application history.
 */
export interface AdminDriverDetails {
  id: string;
  userId: string;

  licenseNumber: string | null;
  licenseExpiry: Date | null;
  verificationStatus: string;
  rejectionReason: string | null;
  availabilityStatus: string | null;

  dob: string | Date | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;

  emergencyContactName: string | null;
  emergencyContactPhone: string | null;

  activeVehicleId: string | null;

  createdAt: Date;
  updatedAt: Date;

  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string;
    status: string;
    role: string;
    createdAt: Date;
    updatedAt: Date;
  };

  partners: Array<{
    id: string;
    businessName: string;
    businessDescription: string | null;
    approvalStatus: string;
    availabilityStatus: string;
    relationshipStatus: string;
    joinedAt: Date;
    updatedAt: Date;
  }>;

  vehicles: Array<{
    id: string;
    make: string;
    model: string;
    color: string | null;
    plateNumber: string;
    sector: string | null;
    category: string | null;
    fuelType: string | null;
    seatingCapacity: number | null;
    manufacturingYear: number | null;
    registrationDate: Date | null;
    registrationExpiry: Date | null;
    isCommercial: boolean;
    permitDetails: unknown;
    verificationStatus: string;
    isActive: boolean;
    retiredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;

  documents: Array<{
    id: string;
    documentType: string;
    storageProvider: string | null;
    resourceType: string | null;
    accessMode: string | null;
    mimeType: string | null;
    fileSize: number | null;
    verificationStatus: string;
    rejectionReason: string | null;
    uploadedBy: string | null;
    verifiedBy: string | null;
    verifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;

  applications: Array<{
    id: string;
    partnerId: string;
    partnerBusinessName: string | null;
    status: string;
    requestedSector: string | null;
    requestedVehicleCategory: string | null;
    vehicleOwnershipType: string | null;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    approvedAt: Date | null;
    reviewReason: string | null;
    reviewedBy: string | null;
    approvedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

/**
 * Admin driver application list item.
 *
 * Represents a driver's application/onboarding history.
 * This is separate from the current driver state represented by AdminDriver.
 */
export interface AdminDriverApplication {
  id: string;
  partnerId: string;
  partnerBusinessName: string;

  driverProfileId: string;
  userId: string;

  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;

  requestedSector: string | null;
  requestedVehicleCategory: string | null;
  vehicleOwnershipType: string | null;

  status: 'PENDING' | 'UNDER_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED';

  submittedAt: Date | null;
  reviewedAt: Date | null;
  approvedAt: Date | null;

  rejectionReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface AdminFilters {
  page: number;
  pageSize: number;

  search?: string | undefined;

  role?: string | undefined;
  status?: string | undefined;

  approvalStatus?: PartnerApprovalStatus | undefined;
  availabilityStatus?: PartnerAvailabilityStatus | undefined;

  from?: string | undefined;
  to?: string | undefined;

  partnerId?: string | undefined;

  active?: boolean | undefined;
  plate?: string | undefined;
  make?: string | undefined;
  model?: string | undefined;

  documentStatus?: string | undefined;
  complianceStatus?: 'compliant' | 'non_compliant' | 'expiring' | 'expired' | undefined;

  /**
   * Driver-specific filters.
   */
  verificationStatus?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;

  /**
   * Driver application-specific filters.
   */
  applicationStatus?: string | undefined;
  requestedSector?: string | undefined;
  requestedVehicleCategory?: string | undefined;
  vehicleOwnershipType?: string | undefined;
}

export interface AdminDashboard {
  users: {
    total: number;
    active: number;
    suspended: number;
  };

  drivers: {
    total: number;
  };

  partners: {
    total: number;
    approved: number;
    pending: number;
    active: number;
  };

  pendingApprovals: number;

  vehicles: {
    total: number;
    active: number;
  };

  kyc: {
    pending: number;
    verified: number;
    rejected: number;
    expired: number;
  };

  vehicleCompliance: {
    insuranceExpiringOrExpired: number;
    permitsExpiringOrExpired: number;
    fitnessExpiringOrExpired: number;
  };
}

export interface FleetAnalyticsSummary {
  totalVehicles: number;
  activeVehicles: number;
  onTripVehicles: number;
  offlineVehicles: number;
  activePercentage: number;
}

export interface StateFleetAnalytics {
  state: string;
  total: number;
  active: number;
  onTrip: number;
  offline: number;
}

export interface CityFleetAnalytics {
  state: string;
  city: string;
  total: number;
  active: number;
  onTrip: number;
  offline: number;
}

export interface LiveFleetVehicle {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  color: string | null;
  sector: string;
  category: string;
  status: 'active' | 'on_trip' | 'offline' | 'registered';
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  state: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  lastLocationAt: string | null;
  currentRideId: string | null;
  verificationStatus: string;
  createdAt: string;
}

export interface FleetFilters {
  state?: string | undefined;
  city?: string | undefined;
  sector?: string | undefined;
  category?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}
