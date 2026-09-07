import { AppError } from '../../../common/errors/app-error.js';
import type {
  CreatePartnerInput,
  PartnerListQuery,
  UpdatePartnerInput,
} from '../schemas/partner.schemas.js';
import type { PartnerRepository } from '../repositories/partner.repository.js';
import type { AuthenticatedUser } from '../../auth/types/auth.js';

export class PartnerService {
  constructor(private readonly repository: PartnerRepository) {}

  async createPartner(data: CreatePartnerInput, actor: AuthenticatedUser) {
    if (actor.role !== 'admin' && actor.role !== 'super_admin' && actor.userId !== data.userId) {
      throw new AppError('FORBIDDEN', 'You do not have permission to create this partner', 403);
    }
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

  async getPartner(id: string, actor: AuthenticatedUser) {
    const partner = await this.repository.findById(id);
    if (!partner) throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    assertPartnerAccess(partner.userId, actor);
    return partner;
  }

  async listPartners(filters: PartnerListQuery, actor: AuthenticatedUser) {
    assertAdmin(actor);
    return this.repository.findAll(filters);
  }

  async updatePartner(id: string, data: UpdatePartnerInput, actor: AuthenticatedUser) {
    const existing = await this.repository.findById(id);
    if (!existing) throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    assertPartnerAccess(existing.userId, actor);
    const partner = await this.repository.update(id, data);
    if (!partner) throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    return partner;
  }
}

function assertAdmin(actor: AuthenticatedUser) {
  if (actor.role !== 'admin' && actor.role !== 'super_admin') {
    throw new AppError('FORBIDDEN', 'You do not have permission to list partners', 403);
  }
}

function assertPartnerAccess(userId: string, actor: AuthenticatedUser) {
  if (actor.role !== 'admin' && actor.role !== 'super_admin' && actor.userId !== userId) {
    throw new AppError('FORBIDDEN', 'You do not have permission to access this partner', 403);
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function isForeignKeyViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23503';
}
