import type { VehicleRepository } from '../../vehicles/repositories/vehicle.repository.js';
import {
  createVehicleTypeSchema,
  updateVehicleTypeSchema,
} from '../../vehicles/schemas/vehicle.schemas.js';
import {
  LEGACY_SERVICE_CATEGORIES,
  LEGACY_PREMIUM_CATEGORIES,
  VEHICLE_FARE_PRICING,
  VEHICLE_PRICING_ALIASES,
} from '../../fares/config/fare.config.js';
import { AppError } from '../../../common/errors/app-error.js';

import type { AdminRepository } from '../repositories/admin.repository.js';

import type { AdminFilters, FleetFilters } from '../types/admin.js';

export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly vehicles?: VehicleRepository,
  ) {}
  async authorize(actorId: string) {
    const actor = await this.repository.getUser(actorId);
    if (!actor || actor.status !== 'active' || !['admin', 'super_admin'].includes(actor.role)) {
      throw new AppError('FORBIDDEN', 'Active administrator access required', 403);
    }
  }
  async driverDocumentAccess(actorId: string, driverId: string, documentId: string, page?: number) {
    if (!this.repository.driverDocumentAccess)
      throw new AppError('DOCUMENT_ACCESS_UNAVAILABLE', 'Document access is unavailable', 503);
    return this.repository.driverDocumentAccess(actorId, driverId, documentId, page);
  }
  private catalog() {
    if (
      !this.vehicles?.createType ||
      !this.vehicles.updateType ||
      !this.vehicles.getType ||
      !this.vehicles.listTypes
    )
      throw new AppError(
        'VEHICLE_CATALOG_UNAVAILABLE',
        'Vehicle configuration is unavailable',
        503,
      );
    return this.vehicles as Required<
      Pick<VehicleRepository, 'createType' | 'updateType' | 'getType' | 'listTypes'>
    >;
  }
  async createVehicleType(actorId: string, body: unknown) {
    const input = createVehicleTypeSchema.parse(body);
    // Canonical pricing aliases cannot acquire a conflicting second tariff.
    if (
      (input.code === 'ftl' &&
        (input.pricingReference?.routeBased !== true ||
          input.baseFare !== null ||
          input.perKmRate !== null)) ||
      Object.hasOwn(VEHICLE_PRICING_ALIASES[input.sector] ?? {}, input.code)
    )
      throw new AppError(
        'VEHICLE_TYPE_INVALID',
        'Use a canonical vehicle code; FTL remains route based.',
        422,
      );
    const definedSectors = Object.keys(VEHICLE_FARE_PRICING).filter((sector) =>
      Object.hasOwn(VEHICLE_FARE_PRICING[sector]!, input.code),
    );
    if ((LEGACY_SERVICE_CATEGORIES as readonly string[]).includes(input.code))
      definedSectors.push('service');
    if ((LEGACY_PREMIUM_CATEGORIES as readonly string[]).includes(input.code))
      definedSectors.push('premium');
    if (definedSectors.length && !definedSectors.includes(input.sector))
      throw new AppError(
        'VEHICLE_TYPE_INVALID',
        'Existing vehicle code belongs to another sector',
        422,
      );
    return this.catalog().createType(actorId, input);
  }
  updateVehicleType(actorId: string, id: string, body: unknown) {
    return this.catalog().updateType(actorId, id, updateVehicleTypeSchema.parse(body));
  }
  listVehicleTypes(limit: number, offset: number) {
    return this.catalog().listTypes(limit, offset);
  }
  async getVehicleType(id: string) {
    const type = await this.catalog().getType(id);
    if (!type) throw new AppError('VEHICLE_TYPE_NOT_FOUND', 'Vehicle type not found', 404);
    return type;
  }

  listUsers(filters: AdminFilters) {
    return this.repository.listUsers(filters);
  }

  listDrivers(filters: AdminFilters) {
    return this.repository.listDrivers(filters);
  }

  listDriverApplications(filters: AdminFilters) {
    return this.repository.listDriverApplications(filters);
  }

  async getDriver(id: string) {
    const driver = await this.repository.getDriver(id);

    if (!driver) {
      throw new AppError('DRIVER_NOT_FOUND', 'Driver not found', 404);
    }

    return driver;
  }

  async getUser(id: string) {
    const user = await this.repository.getUser(id);

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    return user;
  }

  async updateUserStatus(id: string, status: string, actorId?: string) {
    const user = actorId
      ? await this.repository.updateUserStatus(id, status, actorId)
      : await this.repository.updateUserStatus(id, status);

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    return user;
  }

  listPartners(filters: AdminFilters) {
    return this.repository.listPartners(filters);
  }

  async getPartner(id: string) {
    const partner = await this.repository.getPartner(id);

    if (!partner) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    return partner;
  }

  listVehicles(filters: AdminFilters) {
    return this.repository.listVehicles(filters);
  }

  async getVehicle(id: string) {
    const vehicle = await this.repository.getVehicle(id);

    if (!vehicle) {
      throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
    }

    return vehicle;
  }

  dashboard(filters: { from?: string | undefined; to?: string | undefined } = {}) {
    return this.repository.dashboard(filters);
  }

  async verifyDriver(driverId: string, status: string, rejectionReason?: string, actorId?: string) {
    const success = actorId
      ? await this.repository.verifyDriver(driverId, status, rejectionReason, actorId)
      : await this.repository.verifyDriver(driverId, status, rejectionReason);

    if (!success) {
      throw new AppError('DRIVER_NOT_FOUND', 'Driver profile not found', 404);
    }

    return { success: true, driverId, status };
  }

  async verifyVehicle(
    vehicleId: string,
    status: string,
    rejectionReason?: string,
    actorId?: string,
  ) {
    const success = actorId
      ? await this.repository.verifyVehicle(vehicleId, status, rejectionReason, actorId)
      : await this.repository.verifyVehicle(vehicleId, status, rejectionReason);

    if (!success) {
      throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
    }

    return { success: true, vehicleId, status };
  }

  async verifyDocument(documentId: string, status: string, comments?: string, actorId?: string) {
    const success = actorId
      ? await this.repository.verifyDocument(documentId, status, comments, actorId)
      : await this.repository.verifyDocument(documentId, status, comments);

    if (!success) {
      throw new AppError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }

    return { success: true, documentId, status };
  }

  // --- Fleet Analytics Methods ---

  getFleetAnalyticsSummary(filters: FleetFilters) {
    return this.repository.getFleetAnalyticsSummary(filters);
  }

  getStateFleetAnalytics(filters: FleetFilters) {
    return this.repository.getStateFleetAnalytics(filters);
  }

  getCityFleetAnalytics(state: string, filters: FleetFilters) {
    return this.repository.getCityFleetAnalytics(state, filters);
  }

  getLiveFleetVehicles(filters: FleetFilters) {
    return this.repository.getLiveFleetVehicles(filters);
  }

  async getLiveFleetVehicleDetails(id: string) {
    const vehicle = await this.repository.getLiveFleetVehicleDetails(id);

    if (!vehicle) {
      throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
    }

    return vehicle;
  }
}
