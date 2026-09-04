export interface Vehicle {
  id: string;
  driverProfileId: string;
  make: string;
  model: string;
  color: string | null;
  plateNumber: string;
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
}

export interface UpdateVehicleData {
  make?: string | undefined;
  model?: string | undefined;
  color?: string | null | undefined;
  plateNumber?: string | undefined;
}
