import { AppError } from '../../../common/errors/app-error.js';

import type {
  CreatePartnerDocumentInput,
  UpdatePartnerDocumentInput,
} from '../schemas/partner-document.schemas.js';

import type { PartnerDocumentRepository } from '../repositories/partner-document.repository.js';

import type { AuthenticatedUser } from '../../auth/types/auth.js';

import type { PartnerDocument, PartnerDocumentStatus } from '../types/partner-document.js';

export class PartnerDocumentService {
  constructor(private readonly repository: PartnerDocumentRepository) {}

  async createDocumentMetadata(
    partnerId: string,
    data: CreatePartnerDocumentInput,
    actor: AuthenticatedUser,
  ) {
    await this.assertAccess(partnerId, actor);

    if (!(await this.repository.partnerExists(partnerId))) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    if (data.status && data.status !== 'PENDING') {
      throw new AppError(
        'INVALID_DOCUMENT_STATUS_TRANSITION',
        'New documents must start in PENDING status',
        400,
      );
    }

    if (
      data.vehicleId &&
      !(await this.repository.vehicleBelongsToPartner(data.vehicleId, partnerId))
    ) {
      throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle does not belong to partner', 404);
    }

    if (data.issuedAt && data.expiresAt && data.expiresAt < data.issuedAt) {
      throw new AppError('INVALID_DOCUMENT_EXPIRY', 'expiresAt must be on or after issuedAt', 400);
    }
    if (data.expiresAt && data.expiresAt < today()) {
      throw new AppError('INVALID_DOCUMENT_EXPIRY', 'Expired documents cannot be submitted', 400);
    }

    try {
      const document = await this.repository.create({
        partnerId,
        ...data,
        status: data.status ?? 'PENDING',
      });

      return toSafeDocument(document);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('DOCUMENT_ALREADY_EXISTS', 'Document already exists', 409);
      }

      throw error;
    }
  }

  async getDocuments(partnerId: string, actor: AuthenticatedUser) {
    await this.assertAccess(partnerId, actor);

    if (!(await this.repository.partnerExists(partnerId))) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const documents = await this.repository.findByPartner(partnerId);

    return documents.map(toSafeDocument);
  }

  async getDocument(
    partnerId: string,
    documentId: string,
    actor: AuthenticatedUser,
  ): Promise<PartnerDocument> {
    await this.assertAccess(partnerId, actor);

    const document = await this.repository.findById(documentId, partnerId);

    if (!document) {
      throw new AppError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }

    return document;
  }

  async updateDocumentMetadata(
    partnerId: string,
    documentId: string,
    data: UpdatePartnerDocumentInput,
    actor: AuthenticatedUser,
    expectedVersion?: number,
  ) {
    await this.assertAccess(partnerId, actor);
    if (
      data.status &&
      ['VERIFIED', 'REJECTED', 'EXPIRED'].includes(data.status) &&
      (await this.repository.partnerOwnerId(partnerId)) === actor.userId
    )
      throw new AppError('SELF_REVIEW_FORBIDDEN', 'Cannot review your own documents', 403);

    const current = await this.repository.findById(documentId, partnerId);

    if (!current) {
      throw new AppError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }

    if (expectedVersion !== undefined && current.version !== expectedVersion)
      throw new AppError('DOCUMENT_CHANGED', 'Document changed; retry replacement', 409);
    const replacementStorage = data.metadata?.storage;
    const replacingStorage = Boolean(
      replacementStorage &&
      typeof replacementStorage === 'object' &&
      'storageKey' in replacementStorage &&
      replacementStorage.storageKey !== current.metadata?.storage?.storageKey,
    );
    const nextStatus = replacingStorage ? 'PENDING' : (data.status ?? current.status);

    if (
      data.status &&
      ['VERIFIED', 'REJECTED', 'EXPIRED'].includes(data.status) &&
      actor.role !== 'admin' &&
      actor.role !== 'super_admin'
    ) {
      throw new AppError('FORBIDDEN', 'Document review requires an authorized reviewer', 403);
    }

    if (
      data.status &&
      data.status !== current.status &&
      !isAllowedTransition(current.status, data.status)
    ) {
      throw new AppError(
        'INVALID_DOCUMENT_STATUS_TRANSITION',
        `Cannot transition document from ${current.status} to ${data.status}`,
        400,
      );
    }

    const issuedAt = data.issuedAt !== undefined ? data.issuedAt : current.issuedAt;

    const expiresAt = data.expiresAt !== undefined ? data.expiresAt : current.expiresAt;

    if (issuedAt && expiresAt && expiresAt < issuedAt) {
      throw new AppError('INVALID_DOCUMENT_EXPIRY', 'expiresAt must be on or after issuedAt', 400);
    }

    if (nextStatus === 'EXPIRED' && (!expiresAt || expiresAt >= today())) {
      throw new AppError(
        'INVALID_DOCUMENT_EXPIRY',
        'Expired documents must have a past expiry date',
        400,
      );
    }

    if (nextStatus === 'PENDING' && expiresAt && expiresAt < today())
      throw new AppError('INVALID_DOCUMENT_EXPIRY', 'Expired documents cannot be submitted', 400);

    if (nextStatus === 'VERIFIED' && expiresAt && expiresAt < today()) {
      throw new AppError(
        'INVALID_DOCUMENT_EXPIRY',
        'Verified documents cannot already be expired',
        400,
      );
    }

    const updateData: import('../types/partner-document.js').UpdatePartnerDocumentData = {
      ...data,
      ...(data.metadata !== undefined
        ? { metadata: { ...current.metadata, ...data.metadata } }
        : {}),
      status: nextStatus,
      ...(['VERIFIED', 'REJECTED'].includes(nextStatus) && data.status
        ? { reviewedBy: actor.userId, reviewedAt: new Date() }
        : {}),
      verifiedAt:
        nextStatus === 'VERIFIED'
          ? (current.verifiedAt ?? new Date())
          : nextStatus === 'EXPIRED'
            ? current.verifiedAt
            : nextStatus === current.status
              ? current.verifiedAt
              : null,
    };
    const version = expectedVersion ?? current.version;
    const document =
      version === undefined
        ? await this.repository.update(documentId, partnerId, updateData)
        : await this.repository.update(documentId, partnerId, updateData, version);

    if (!document) {
      throw new AppError('DOCUMENT_CHANGED', 'Document not found', 404);
    }

    return toSafeDocument(document);
  }

  async deleteDocument(
    partnerId: string,
    documentId: string,
    actor: AuthenticatedUser,
  ): Promise<PartnerDocument> {
    await this.assertAccess(partnerId, actor);

    const document = await this.repository.delete(documentId, partnerId);

    if (!document) {
      throw new AppError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }

    return document;
  }

  async assertAccess(partnerId: string, actor: AuthenticatedUser): Promise<void> {
    if (
      !['driver', 'fleet_owner', 'driver_fleet_owner', 'admin', 'super_admin'].includes(actor.role)
    )
      throw new AppError('FORBIDDEN', 'Provider document access requires a provider role', 403);
    if (actor.role === 'admin' || actor.role === 'super_admin') {
      return;
    }

    const owner = await this.repository.partnerOwnerId(partnerId);

    if (!owner) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    if (owner !== actor.userId) {
      throw new AppError('FORBIDDEN', 'You do not have permission to access this partner', 403);
    }
  }
}

const allowedTransitions: Record<PartnerDocumentStatus, readonly PartnerDocumentStatus[]> = {
  PENDING: ['SUBMITTED'],
  SUBMITTED: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['EXPIRED'],
  REJECTED: ['SUBMITTED'],
  EXPIRED: [],
};

function isAllowedTransition(from: PartnerDocumentStatus, to: PartnerDocumentStatus): boolean {
  return allowedTransitions[from].includes(to);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function toSafeDocument(
  document: PartnerDocument,
): Omit<PartnerDocument, 'metadata'> & { documentMetadata?: Record<string, unknown> } {
  const { metadata, ...safeDocument } = document;
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([key]) =>
      [
        'documentCode',
        'documentNumber',
        'issuingAuthority',
        'issuedAt',
        'expiresAt',
        'uploadSource',
        'side',
        'rejectionReason',
      ].includes(key),
    ),
  );
  return { ...safeDocument, documentMetadata: safeMetadata };
}
