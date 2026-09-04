import { AppError } from '../../../common/errors/app-error.js';
import type {
  CreateVehicleInput,
  DeactivateVehicleInput,
  UpdateVehicleInput,
  VehicleDriverQuery,
} from '../schemas/vehicle.schemas.js';
import type { VehicleRepository } from '../repositories/vehicle.repository.js';

export class VehicleService {
  constructor(private readonly repository: VehicleRepository) {}

  async createVehicle(data: CreateVehicleInput) {
    try {
      return await this.repository.create(data);
    } catch (error) {
      throw translateVehicleError(error);
    }
  }

  async getVehicle(id: string) {
    const vehicle = await this.repository.findById(id);
    if (!vehicle) throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
    return vehicle;
  }

  async listVehicles(query: VehicleDriverQuery) {
    if (!(await this.repository.driverProfileExists(query.driverProfileId))) {
      throw new AppError('DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found', 404);
    }
    return this.repository.findByDriver(query.driverProfileId, query.activeOnly);
  }

  async updateVehicle(id: string, data: UpdateVehicleInput) {
    try {
      const vehicle = await this.repository.update(id, data);
      if (!vehicle) throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
      return vehicle;
    } catch (error) {
      throw translateVehicleError(error);
    }
  }

  async deactivateVehicle(id: string, data: DeactivateVehicleInput) {
    const vehicle = await this.repository.deactivate(id, data.retiredAt ?? new Date());
    if (!vehicle) throw new AppError('VEHICLE_NOT_FOUND', 'Active vehicle not found', 404);
    return vehicle;
  }
}

function translateVehicleError(error: unknown): unknown {
  if (isPostgresCode(error, '23503')) {
    return new AppError('DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found', 404);
  }
  if (isPostgresCode(error, '23505')) {
    return new AppError(
      'VEHICLE_CONFLICT',
      'Vehicle conflicts with an active vehicle or plate number',
      409,
    );
  }
  return error;
}

function isPostgresCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
