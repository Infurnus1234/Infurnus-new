import { AppError } from '../../../common/errors/app-error.js';
import type {
  CreatePartnerInput,
  PartnerListQuery,
  ReviewPartnerInput,
  UpdatePartnerInput,
} from '../schemas/partner.schemas.js';
import type { PartnerRepository } from '../repositories/partner.repository.js';
import type { AuthenticatedUser } from '../../auth/types/auth.js';

export class PartnerService {
  constructor(private readonly repository: PartnerRepository) {}

  async createPartner(data: CreatePartnerInput, actor: AuthenticatedUser) {
    if (
      !['driver', 'fleet_owner', 'driver_fleet_owner', 'admin', 'super_admin'].includes(actor.role)
    ) {
      throw new AppError(
        'FORBIDDEN',
        'Provider registration requires an authorized provider account',
        403,
      );
    }
    if (actor.role !== 'admin' && actor.role !== 'super_admin' && actor.userId !== data.userId) {
      throw new AppError('FORBIDDEN', 'You do not have permission to create this partner', 403);
    }

    try {
      return await this.repository.create({
        ...data,
        providerType: ['admin', 'super_admin'].includes(actor.role)
          ? data.providerType
          : actor.role === 'driver_fleet_owner'
            ? 'DRIVER_AND_FLEET_OWNER'
            : actor.role === 'fleet_owner'
              ? 'FLEET_OWNER'
              : 'DRIVER',
      });
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

    if (!partner) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    assertPartnerAccess(partner.userId, actor);

    return partner;
  }

  async getMyPartner(actor: AuthenticatedUser) {
    const partner = await this.repository.findByUserId(actor.userId);

    if (!partner) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found for current user', 404);
    }

    return partner;
  }

  async listPartners(filters: PartnerListQuery, actor: AuthenticatedUser) {
    assertAdmin(actor);

    return this.repository.findAll(filters);
  }

  async updatePartner(id: string, data: UpdatePartnerInput, actor: AuthenticatedUser) {
    const existing = await this.repository.findById(id);

    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    assertPartnerAccess(existing.userId, actor);

    if (data.availabilityStatus === 'available' && existing.approvalStatus !== 'approved') {
      throw new AppError(
        'PARTNER_NOT_APPROVED',
        'Partner must be approved before becoming available',
        409,
      );
    }

    const partner = await this.repository.update(id, data);

    if (!partner) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    return partner;
  }

  async reviewPartner(id: string, data: ReviewPartnerInput, actor: AuthenticatedUser) {
    assertSuperAdmin(actor);

    const partner = await this.repository.findById(id);

    if (!partner) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    if (partner.userId === actor.userId)
      throw new AppError('SELF_REVIEW_FORBIDDEN', 'Cannot review your own fleet', 403);
    assertValidApprovalTransition(partner.approvalStatus, data.status);

    if (data.status === 'rejected' && !data.reason?.trim()) {
      throw new AppError('REVIEW_REASON_REQUIRED', 'Rejection reason is required', 400);
    }

    const reviewedPartner = await this.repository.review(
      id,
      data.status,
      actor.userId,
      data.reason,
    );

    if (!reviewedPartner) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    return reviewedPartner;
  }
}

function assertAdmin(actor: AuthenticatedUser) {
  if (actor.role !== 'admin' && actor.role !== 'super_admin') {
    throw new AppError('FORBIDDEN', 'You do not have permission to list partners', 403);
  }
}

function assertSuperAdmin(actor: AuthenticatedUser) {
  if (actor.role !== 'super_admin') {
    throw new AppError('FORBIDDEN', 'Only a super admin can review partner approval requests', 403);
  }
}

function assertPartnerAccess(userId: string, actor: AuthenticatedUser) {
  if (actor.role !== 'admin' && actor.role !== 'super_admin' && actor.userId !== userId) {
    throw new AppError('FORBIDDEN', 'You do not have permission to access this partner', 403);
  }
}

function assertValidApprovalTransition(
  currentStatus: string,
  nextStatus: 'under_review' | 'approved' | 'rejected',
) {
  if (currentStatus === 'pending' && nextStatus === 'under_review') {
    return;
  }

  if (
    currentStatus === 'under_review' &&
    (nextStatus === 'approved' || nextStatus === 'rejected')
  ) {
    return;
  }

  throw new AppError(
    'INVALID_PARTNER_APPROVAL_TRANSITION',
    `Partner approval cannot transition from ${currentStatus} to ${nextStatus}`,
    409,
  );
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function isForeignKeyViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23503';
}
