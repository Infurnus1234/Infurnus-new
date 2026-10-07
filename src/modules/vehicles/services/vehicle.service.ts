import { AppError } from '../../../common/errors/app-error.js';

import type {
  CreateVehicleInput,
  DeactivateVehicleInput,
  UpdateVehicleInput,
  VehicleDriverQuery,
  VehicleFleetQuery,
} from '../schemas/vehicle.schemas.js';

import type { VehicleRepository } from '../repositories/vehicle.repository.js';

export class VehicleService {
  constructor(private readonly repository: VehicleRepository) {}
  async assertReadAccess(
    actor: { userId: string; role: string },
    vehicleId?: string,
    driverProfileId?: string,
  ) {
    if (['admin', 'super_admin'].includes(actor.role)) return;
    if (vehicleId) {
      const vehicle = await this.getVehicle(vehicleId);
      if (vehicle.ownerId === actor.userId) return;
      driverProfileId = vehicle.driverProfileId ?? undefined;
    }
    if (
      driverProfileId &&
      this.repository.driverProfileOwnerId &&
      (await this.repository.driverProfileOwnerId(driverProfileId)) === actor.userId
    )
      return;
    throw new AppError('FORBIDDEN', 'Vehicle access is not authorized', 403);
  }

  async createVehicle(data: CreateVehicleInput) {
    await this.validateVehicleReferences(data);

    try {
      return await this.repository.create(data);
    } catch (error) {
      throw translateVehicleError(error);
    }
  }

  async getVehicle(id: string) {
    const vehicle = await this.repository.findById(id);

    if (!vehicle) {
      throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
    }

    return vehicle;
  }

  async listVehicles(query: VehicleDriverQuery) {
    const driverExists = await this.repository.driverProfileExists(query.driverProfileId);

    if (!driverExists) {
      throw new AppError('DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found', 404);
    }

    return this.repository.findByDriver(query.driverProfileId, query.activeOnly);
  }

  async listFleet(query: VehicleFleetQuery) {
    return this.repository.listFleet(query.sector, query.category);
  }

  async updateVehicle(id: string, data: UpdateVehicleInput) {
    await this.getVehicle(id);

    try {
      const vehicle = await this.repository.update(id, data);

      if (!vehicle) {
        throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
      }

      return vehicle;
    } catch (error) {
      throw translateVehicleError(error);
    }
  }

  async deactivateVehicle(id: string, data: DeactivateVehicleInput) {
    const vehicle = await this.getVehicle(id);

    if (!vehicle.isActive) {
      throw new AppError('VEHICLE_ALREADY_INACTIVE', 'Vehicle is already inactive', 409);
    }

    try {
      const deactivatedVehicle = await this.repository.deactivate(id, data.retiredAt ?? new Date());

      if (!deactivatedVehicle) {
        throw new AppError('VEHICLE_NOT_FOUND', 'Active vehicle not found', 404);
      }

      return deactivatedVehicle;
    } catch (error) {
      throw translateVehicleError(error);
    }
  }

  private async validateVehicleReferences(data: CreateVehicleInput): Promise<void> {
    if (data.driverProfileId) {
      const driverExists = await this.repository.driverProfileExists(data.driverProfileId);

      if (!driverExists) {
        throw new AppError('DRIVER_PROFILE_NOT_FOUND', 'Driver profile not found', 404);
      }
    }

    if (
      data.registrationDate &&
      data.registrationExpiry &&
      data.registrationExpiry < data.registrationDate
    ) {
      throw new AppError(
        'INVALID_REGISTRATION_PERIOD',
        'Registration expiry must be on or after registration date',
        400,
      );
    }

    if (
      data.manufacturingYear !== null &&
      data.manufacturingYear !== undefined &&
      data.registrationDate &&
      data.manufacturingYear > data.registrationDate.getFullYear()
    ) {
      throw new AppError(
        'INVALID_MANUFACTURING_YEAR',
        'Manufacturing year cannot be after registration year',
        400,
      );
    }
  }
}

function translateVehicleError(error: unknown): unknown {
  if (error instanceof AppError) {
    return error;
  }

  if (isPostgresCode(error, '23503')) {
    return new AppError(
      'VEHICLE_REFERENCE_NOT_FOUND',
      'Referenced driver or vehicle owner was not found',
      404,
    );
  }

  if (isPostgresCode(error, '23505')) {
    return new AppError(
      'VEHICLE_CONFLICT',
      'Vehicle conflicts with an existing vehicle or unique constraint',
      409,
    );
  }

  if (isPostgresCode(error, '23514')) {
    return new AppError(
      'VEHICLE_VALIDATION_FAILED',
      'Vehicle data violates a database validation rule',
      400,
    );
  }

  return error;
}

function isPostgresCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
