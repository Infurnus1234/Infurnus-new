import { AppError } from '../../../common/errors/app-error.js';
import type { AuthenticatedUser } from '../../auth/types/auth.js';
import type {
  CreateFleetVehicleInput,
  UpdateFleetVehicleInput,
} from '../../fleet/schemas/fleet.schemas.js';
import type { FleetService } from '../../fleet/services/fleet.service.js';
import type { PartnerRepository } from '../repositories/partner.repository.js';

export class PartnerVehicleService {
  constructor(
    private readonly partnerRepository: PartnerRepository,
    private readonly fleetService: FleetService,
  ) {}

  private async getApprovedPartnerUserId(actor: AuthenticatedUser): Promise<string> {
    const partner = await this.partnerRepository.findByUserId(actor.userId);

    if (!partner) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner profile not found for current user', 404);
    }

    if (partner.approvalStatus !== 'approved') {
      throw new AppError(
        'PARTNER_NOT_APPROVED',
        'Partner must be approved before managing vehicles',
        403,
      );
    }

    return partner.userId;
  }

  async listVehicles(actor: AuthenticatedUser) {
    const ownerId = await this.getApprovedPartnerUserId(actor);

    return this.fleetService.listVehicles(ownerId);
  }

  async createVehicle(actor: AuthenticatedUser, input: CreateFleetVehicleInput) {
    const ownerId = await this.getApprovedPartnerUserId(actor);

    return this.fleetService.createVehicle(ownerId, input);
  }

  async updateVehicle(actor: AuthenticatedUser, vehicleId: string, input: UpdateFleetVehicleInput) {
    const ownerId = await this.getApprovedPartnerUserId(actor);

    return this.fleetService.updateVehicle(ownerId, vehicleId, input);
  }

  async deactivateVehicle(actor: AuthenticatedUser, vehicleId: string) {
    const ownerId = await this.getApprovedPartnerUserId(actor);

    const deactivated = await this.fleetService.deactivateVehicle(ownerId, vehicleId);

    if (!deactivated) {
      throw new AppError('VEHICLE_NOT_FOUND', 'Active vehicle not found', 404);
    }

    return { id: vehicleId };
  }
}
