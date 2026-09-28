import { AppError } from '../../../common/errors/app-error.js';
import type { AuthenticatedUser } from '../../auth/types/auth.js';
import type { PartnerDriver, PartnerDriverStatus } from '../types/partner-driver.js';
import type { PartnerRepository } from '../repositories/partner.repository.js';
import type { PartnerDriverRepository } from '../repositories/partner-driver.repository.js';

export class PartnerDriverService {
  constructor(
    private readonly partnerRepository: PartnerRepository,
    private readonly partnerDriverRepository: PartnerDriverRepository,
  ) {}

  private async getApprovedPartner(actor: AuthenticatedUser) {
    const partner = await this.partnerRepository.findByUserId(actor.userId);

    if (!partner) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner profile not found for current user', 404);
    }

    if (partner.approvalStatus !== 'approved') {
      throw new AppError(
        'PARTNER_NOT_APPROVED',
        'Partner must be approved before managing drivers',
        403,
      );
    }

    return partner;
  }

  async listDrivers(
    actor: AuthenticatedUser,
    status?: PartnerDriverStatus,
  ): Promise<PartnerDriver[]> {
    const partner = await this.getApprovedPartner(actor);

    return this.partnerDriverRepository.listByPartner(partner.id, status);
  }

  async updateStatus(
    actor: AuthenticatedUser,
    relationshipId: string,
    status: PartnerDriverStatus,
  ): Promise<PartnerDriver> {
    const partner = await this.getApprovedPartner(actor);

    if (status !== 'INACTIVE') {
      throw new AppError(
        'PARTNER_DRIVER_STATUS_FORBIDDEN',
        'Partner can only deactivate an existing driver relationship',
        403,
      );
    }

    const relationship = await this.partnerDriverRepository.findById(relationshipId);

    if (!relationship) {
      throw new AppError('PARTNER_DRIVER_NOT_FOUND', 'Partner-driver relationship not found', 404);
    }

    if (relationship.partnerId !== partner.id) {
      throw new AppError(
        'PARTNER_DRIVER_FORBIDDEN',
        'You do not have access to this driver relationship',
        403,
      );
    }

    const updated = await this.partnerDriverRepository.updateStatus(relationshipId, 'INACTIVE');

    if (!updated) {
      throw new AppError('PARTNER_DRIVER_NOT_FOUND', 'Partner-driver relationship not found', 404);
    }

    return updated;
  }
}
