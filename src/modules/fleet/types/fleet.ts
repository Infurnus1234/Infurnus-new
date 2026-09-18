export interface FleetDashboardMetrics {
  totalVehicles: number;
  activeVehicles: number;
  availableVehicles: number;
  maintenanceVehicles: number;
  totalDrivers: number;
  availableDrivers: number;
  pendingDocuments: number;
  activeTrips: number;
  todayRevenue: number;
}

export interface FleetVehicle {
  id: string;
  ownerId: string;
  driverProfileId: string | null;
  make: string;
  model: string;
  color: string | null;
  plateNumber: string;
  sector: string;
  category: string;
  fuelRatePerKm: number;
  loadCapacityKg: number;
  year?: number | null;
  fuelType?: string | null;
  seatingCapacity?: number | null;
  registrationDate?: string | null;
  registrationExpiry?: string | null;
  isCommercial: boolean;
  permitDetails?: string | null;
  verificationStatus: string;
  isActive: boolean;
  assignedDriver?: {
    id: string;
    userId: string;
    name: string;
    phone: string;
    availabilityStatus?: string | null;
  } | null;
  activeAssignmentCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FleetDriver {
  id: string;
  userId: string;
  name: string;
  phone: string;
  email?: string | null;
  licenseNumber: string;
  licenseExpiry: string;
  verificationStatus: string;
  availabilityStatus?: string | null;
  assignedVehicle?: {
    id: string;
    make: string;
    model: string;
    plateNumber: string;
  } | null;
  completedTrips: number;
  totalEarnings: number;
}

export interface FleetTrip {
  id: string;
  vehicleId: string;
  vehiclePlate: string;
  driverName?: string | null;
  pickupAddress: string | null;
  destinationAddress: string | null;
  status: string;
  fareEstimate?: number | null;
  finalFare?: number | null;
  actualDistanceMeters?: number | null;
  createdAt: Date;
  completedAt?: Date | null;
}

export interface FleetEarningsSummary {
  todayRevenue: number;
  thisWeekRevenue: number;
  thisMonthRevenue: number;
  totalTrips: number;
  platformCommission: number;
  netPayout: number;
}
