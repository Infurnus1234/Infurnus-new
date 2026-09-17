export interface Vehicle {
  id: string;
  driverProfileId: string;
  make: string;
  model: string;
  color: string | null;
  plateNumber: string;
  sector: string;
  category: string;
  fuelRatePerKm: number;
  loadCapacityKg: number;
  isActive: boolean;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateVehicleData {
  driverProfileId: string;
  make: string;
  model: string;
  color?: string | undefined;
  plateNumber: string;
  sector?: string | undefined;
  category?: string | undefined;
  fuelRatePerKm?: number | undefined;
  loadCapacityKg?: number | undefined;
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
}
