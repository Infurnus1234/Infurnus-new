import { AppError } from '../../../common/errors/app-error.js';
import type {
  CreatePartnerInput,
  PartnerListQuery,
  UpdatePartnerInput,
} from '../schemas/partner.schemas.js';
import type { PartnerRepository } from '../repositories/partner.repository.js';

export class PartnerService {
  constructor(private readonly repository: PartnerRepository) {}

  async createPartner(data: CreatePartnerInput) {
    try {
      return await this.repository.create(data);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new AppError('USER_NOT_FOUND', 'User not found', 404);
      }
      if (isUniqueViolation(error)) {
        throw new AppError('PARTNER_ALREADY_EXISTS', 'A partner already exists for this user', 409);
      }
      throw error;
    }
  }

  async getPartner(id: string) {
    const partner = await this.repository.findById(id);
    if (!partner) throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    return partner;
  }

  async listPartners(filters: PartnerListQuery) {
    return this.repository.findAll(filters);
  }

  async updatePartner(id: string, data: UpdatePartnerInput) {
    const partner = await this.repository.update(id, data);
    if (!partner) throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    return partner;
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function isForeignKeyViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23503';
}
