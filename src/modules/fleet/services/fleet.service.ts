import { AppError } from '../../../common/errors/app-error.js';
import type { FleetListQuery } from '../schemas/fleet.schemas.js';
import type { FleetRepository } from '../repositories/fleet.repository.js';
import type { CreateFleetVehicleInput, UpdateFleetVehicleInput } from '../schemas/fleet.schemas.js';
import type {
  FleetDashboardMetrics,
  FleetDriver,
  FleetEarningsSummary,
  FleetTrip,
  FleetVehicle,
} from '../types/fleet.js';

export class FleetService {
  constructor(private readonly fleetRepo: FleetRepository) {}

  async revenue(
    ownerId: string,
    filter: import('../repositories/fleet-revenue.repository.js').RevenueFilter = {},
  ) {
    return this.fleetRepo.revenue(ownerId, filter);
  }
  async catalog(ownerId?: string) {
    return this.fleetRepo.catalog(ownerId);
  }

  async getDashboard(ownerId: string): Promise<FleetDashboardMetrics> {
    return this.fleetRepo.getDashboard(ownerId);
  }

  async listVehicles(ownerId: string, query?: FleetListQuery): Promise<FleetVehicle[]> {
    return query
      ? this.fleetRepo.listVehicles(ownerId, query)
      : this.fleetRepo.listVehicles(ownerId);
  }

  async createVehicle(ownerId: string, input: CreateFleetVehicleInput): Promise<FleetVehicle> {
    return this.fleetRepo.createVehicle(ownerId, input);
  }

  async updateVehicle(
    ownerId: string,
    vehicleId: string,
    input: UpdateFleetVehicleInput,
  ): Promise<FleetVehicle | null> {
    return this.fleetRepo.updateVehicle(ownerId, vehicleId, input);
  }

  async deactivateVehicle(ownerId: string, vehicleId: string): Promise<boolean> {
    return this.fleetRepo.deactivateVehicle(ownerId, vehicleId);
  }

  async generateAssignmentCode(
    ownerId: string,
    vehicleId: string,
    driverProfileId?: string,
  ): Promise<{ code: string; expiresAt: Date }> {
    try {
      return await (driverProfileId
        ? this.fleetRepo.generateAssignmentCode(ownerId, vehicleId, driverProfileId)
        : this.fleetRepo.generateAssignmentCode(ownerId, vehicleId));
    } catch (e) {
      if (
        e instanceof Error &&
        [
          'DRIVER_NOT_ELIGIBLE_FOR_ASSIGNMENT',
          'VEHICLE_NOT_AVAILABLE_FOR_ASSIGNMENT',
          'ASSIGNMENT_CODE_CAPACITY_EXCEEDED',
        ].includes(e.message)
      )
        throw new AppError(
          e.message,
          'The Driver or vehicle is not available for this assignment. Refresh fleet status.',
          409,
        );
      throw e;
    }
  }

  async unassignDriver(ownerId: string, vehicleId: string): Promise<boolean> {
    return this.fleetRepo.unassignDriver(ownerId, vehicleId);
  }

  async listDrivers(ownerId: string, query?: FleetListQuery): Promise<FleetDriver[]> {
    return query ? this.fleetRepo.listDrivers(ownerId, query) : this.fleetRepo.listDrivers(ownerId);
  }

  async listTrips(ownerId: string, limit?: number): Promise<FleetTrip[]> {
    return this.fleetRepo.listTrips(ownerId, limit);
  }

  async getEarnings(ownerId: string): Promise<FleetEarningsSummary> {
    return this.fleetRepo.getEarnings(ownerId);
  }
}
