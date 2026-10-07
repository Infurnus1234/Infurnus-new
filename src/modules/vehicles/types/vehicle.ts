export interface Vehicle {
  id: string;

  /**
   * A vehicle may exist without an assigned driver.
   * This supports Partner Owned vehicles before driver assignment.
   */
  driverProfileId: string | null;

  /**
   * User who owns the vehicle.
   * Backed by vehicles.owner_id -> users.id.
   */
  ownerId: string | null;

  make: string;
  model: string;
  color: string | null;
  plateNumber: string;

  /**
   * Service sector and vehicle category.
   * Rental is supported at the application level even though
   * the legacy vehicle DB constraint currently needs separate handling.
   */
  sector: string;
  category: string;

  fuelRatePerKm: number;
  loadCapacityKg: number;

  manufacturingYear: number | null;
  fuelType: string | null;
  seatingCapacity: number | null;

  registrationDate: Date | null;
  registrationExpiry: Date | null;

  isCommercial: boolean;
  permitDetails: string | null;

  /**
   * Vehicle verification is separate from operational activation.
   */
  verificationStatus: string;

  /**
   * Operational state.
   * This must not be treated as verification/approval state.
   */
  isActive: boolean;
  retiredAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateVehicleData {
  /**
   * Optional because a Partner Owned vehicle can be created
   * before a driver is assigned.
   */
  driverProfileId?: string | null | undefined;

  /**
   * Vehicle owner.
   */
  ownerId?: string | null | undefined;

  make: string;
  model: string;
  color?: string | null | undefined;
  plateNumber: string;

  sector?: string | undefined;
  category?: string | undefined;

  fuelRatePerKm?: number | undefined;
  loadCapacityKg?: number | undefined;

  manufacturingYear?: number | null | undefined;
  fuelType?: string | null | undefined;
  seatingCapacity?: number | null | undefined;

  registrationDate?: Date | null | undefined;
  registrationExpiry?: Date | null | undefined;

  isCommercial?: boolean | undefined;
  permitDetails?: string | null | undefined;
}

export interface UpdateVehicleData {
  make?: string | undefined;
  model?: string | undefined;
  color?: string | null | undefined;
  plateNumber?: string | undefined;

  sector?: string | undefined;
  category?: string | undefined;

  fuelRatePerKm?: number | undefined;
  loadCapacityKg?: number | undefined;

  manufacturingYear?: number | null | undefined;
  fuelType?: string | null | undefined;
  seatingCapacity?: number | null | undefined;

  registrationDate?: Date | null | undefined;
  registrationExpiry?: Date | null | undefined;

  isCommercial?: boolean | undefined;
  permitDetails?: string | null | undefined;
}

/** Admin catalog rates use integer paise internally; category is the code on rides/inventory. */
export interface VehicleType {
  id: string;
  name: string;
  code: string;
  sector: 'passenger' | 'logistics' | 'service' | 'premium';
  baseFare: number;
  perKmRate: number;
  currency: 'INR';
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface VehicleFareSnapshot {
  id: string;
  code: string;
  sector: string;
  version: number;
  baseFarePaise: number;
  perKmRatePaise: number;
}
