import type { FleetRepository } from '../repositories/fleet.repository.js';
import type {
  CreateFleetVehicleInput,
  UpdateFleetVehicleInput,
} from '../schemas/fleet.schemas.js';
import type {
  FleetDashboardMetrics,
  FleetDriver,
  FleetEarningsSummary,
  FleetTrip,
  FleetVehicle,
} from '../types/fleet.js';

export class FleetService {
  constructor(private readonly fleetRepo: FleetRepository) {}

  async getDashboard(ownerId: string): Promise<FleetDashboardMetrics> {
    return this.fleetRepo.getDashboard(ownerId);
  }

  async listVehicles(ownerId: string): Promise<FleetVehicle[]> {
    return this.fleetRepo.listVehicles(ownerId);
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
  ): Promise<{ code: string; expiresAt: Date }> {
    return this.fleetRepo.generateAssignmentCode(ownerId, vehicleId);
  }

  async unassignDriver(ownerId: string, vehicleId: string): Promise<boolean> {
    return this.fleetRepo.unassignDriver(ownerId, vehicleId);
  }

  async listDrivers(ownerId: string): Promise<FleetDriver[]> {
    return this.fleetRepo.listDrivers(ownerId);
  }

  async listTrips(ownerId: string, limit?: number): Promise<FleetTrip[]> {
    return this.fleetRepo.listTrips(ownerId, limit);
  }

  async getEarnings(ownerId: string): Promise<FleetEarningsSummary> {
    return this.fleetRepo.getEarnings(ownerId);
  }
}
