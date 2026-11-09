import type { OperatingLocation } from '../../maps/vehicle-operating-location.js';
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
  operatingLocation?: OperatingLocation | null | undefined;
  operatingCityId?: string | null | undefined;

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
  operatingLocation?: OperatingLocation | null | undefined;
  operatingCityId?: string | null | undefined;

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
  operatingLocation?: OperatingLocation | null | undefined;
  operatingCityId?: string | undefined;

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

export interface FixedHourlyPricing {
  hourlyRate: number;
  fuelRate: number;
  fuelUnit: 'per_booking' | 'per_hour' | 'per_km';
}

/** Admin catalog rates use integer paise internally; category is the code on rides/inventory. */
export interface VehicleType {
  fixedHourlyPricing?: FixedHourlyPricing;
  rentalPricingVersion?: number;
  catalogVisible?: boolean;
  registrationActive?: boolean;
  serviceFixedFare?: number | null;
  serviceRadiusMeters?: number;
  logisticsSlabs?: import('../services/logistics-pricing.js').LogisticsSlabs | null;
  pricingStatus?: 'needs_pricing' | 'inactive' | 'quote_required' | 'available';
  id: string;
  name: string;
  code: string;
  sector: 'passenger' | 'logistics' | 'service' | 'premium' | 'rental';
  baseFare: number | null;
  perKmRate: number | null;
  pricingReference?: import('../../fares/types/fare.js').VehiclePricing | null;
  hourlyBaseFares?: Partial<
    Record<import('../services/hourly-pricing.js').HourlyFareBucket, number>
  > | null;
  missingDurationPolicy?: 'legacy_base' | 'require_duration';
  extendedDurationPolicy?: 'booked_duration' | null;
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
  serviceRadiusMeters?: number;
  pricingModel?: 'service_fixed' | 'fixed_hourly';
  logisticsSlab?: 'below_15' | 'from_15';
  durationBucket?: import('../services/hourly-pricing.js').HourlyFareBucket;
  bookedHours?: number;
  extendedDurationPolicy?: 'booked_duration';
  demandPricing?: import('../../fares/types/fare.js').DemandPricingProvenance;
}
