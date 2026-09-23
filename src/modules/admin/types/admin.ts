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
}

export interface AdminPartnerVehicle {
  id: string;
  plateNumber: string;
  isActive: boolean;
  insuranceStatus: string | null;
  permitStatus: string | null;
  fitnessStatus: string | null;
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
}

export interface AdminDashboard {
  users: { total: number; active: number; suspended: number };
  partners: { total: number; approved: number; pending: number; active: number };
  vehicles: { total: number; active: number };
  kyc: { pending: number; verified: number; rejected: number; expired: number };
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
