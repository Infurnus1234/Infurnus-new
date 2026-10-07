import { describe, expect, it, vi } from 'vitest';

import { PartnerDocumentService } from '../services/partner-document.service.js';
import type { PartnerDocumentRepository } from '../repositories/partner-document.repository.js';
import type { PartnerDocument } from '../types/partner-document.js';

const partnerId = '650e8400-e29b-41d4-a716-446655440000';
const ownerId = '550e8400-e29b-41d4-a716-446655440000';
const documentId = '750e8400-e29b-41d4-a716-446655440000';
const actor = {
  userId: ownerId,
  role: 'fleet_owner',
} as const;

const document = (status: PartnerDocument['status'] = 'PENDING'): PartnerDocument => ({
  id: documentId,
  partnerId,
  vehicleId: null,
  documentType: 'AADHAAR',
  status,
  issuedAt: null,
  expiresAt: '2099-01-01',
  uploadedAt: new Date('2026-01-01'),
  verifiedAt: status === 'VERIFIED' || status === 'EXPIRED' ? new Date('2026-01-02') : null,
  metadata: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
});

function repository(current = document()): PartnerDocumentRepository {
  return {
    partnerExists: vi.fn().mockResolvedValue(true),
    partnerOwnerId: vi.fn().mockResolvedValue(ownerId),
    vehicleBelongsToPartner: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockRejectedValue({
      code: '23505',
    }),
    findByPartner: vi.fn().mockResolvedValue([current]),
    findById: vi.fn().mockResolvedValue(current),
    update: vi.fn().mockImplementation(async (_id, _partnerId, data) => ({
      ...current,
      ...data,
      status: data.status ?? current.status,
    })),
    delete: vi.fn().mockResolvedValue(null),
  };
}

describe('PartnerDocumentService', () => {
  it('maps duplicate required documents to a conflict', async () => {
    const service = new PartnerDocumentService(repository());

    await expect(
      service.createDocumentMetadata(
        partnerId,
        {
          documentType: 'AADHAAR',
          metadata: {
            internalValue: 'secret',
          },
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_ALREADY_EXISTS',
      statusCode: 409,
    });
  });

  it('rejects invalid vehicle ownership before insert', async () => {
    const repo = repository();

    vi.mocked(repo.vehicleBelongsToPartner).mockResolvedValue(false);

    const service = new PartnerDocumentService(repo);

    await expect(
      service.createDocumentMetadata(
        partnerId,
        {
          vehicleId: '850e8400-e29b-41d4-a716-446655440000',
          documentType: 'VEHICLE_RC',
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: 'VEHICLE_NOT_FOUND',
      statusCode: 404,
    });

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('allows only defined lifecycle transitions and sets verification time', async () => {
    const repo = repository(document('SUBMITTED'));

    const service = new PartnerDocumentService(repo);

    await service.updateDocumentMetadata(
      partnerId,
      documentId,
      { status: 'VERIFIED' },
      { userId: 'reviewer', role: 'admin' },
    );

    expect(repo.update).toHaveBeenCalledWith(
      documentId,
      partnerId,
      expect.objectContaining({
        status: 'VERIFIED',
        verifiedAt: expect.any(Date),
      }),
    );

    const invalid = new PartnerDocumentService(repository(document('PENDING')));

    await expect(
      invalid.updateDocumentMetadata(
        partnerId,
        documentId,
        { status: 'VERIFIED' },
        { userId: 'reviewer', role: 'admin' },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT_STATUS_TRANSITION',
      statusCode: 400,
    });
  });

  it('forbids a provider from reviewing their own submitted document', async () => {
    const repo = repository(document('SUBMITTED'));
    await expect(
      new PartnerDocumentService(repo).updateDocumentMetadata(
        partnerId,
        documentId,
        { status: 'VERIFIED' },
        actor,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('allows submission and expiration transitions with consistent timestamps', async () => {
    const submittedRepository = repository(document('PENDING'));

    await new PartnerDocumentService(submittedRepository).updateDocumentMetadata(
      partnerId,
      documentId,
      { status: 'SUBMITTED' },
      actor,
    );

    expect(submittedRepository.update).toHaveBeenCalledWith(
      documentId,
      partnerId,
      expect.objectContaining({
        status: 'SUBMITTED',
        verifiedAt: null,
      }),
    );

    const expiredRepository = repository(document('VERIFIED'));

    const current = document('VERIFIED');
    current.expiresAt = '2020-01-01';

    vi.mocked(expiredRepository.findById).mockResolvedValue(current);

    await new PartnerDocumentService(expiredRepository).updateDocumentMetadata(
      partnerId,
      documentId,
      { status: 'EXPIRED' },
      { userId: 'reviewer', role: 'admin' },
    );

    expect(expiredRepository.update).toHaveBeenCalledWith(
      documentId,
      partnerId,
      expect.objectContaining({
        status: 'EXPIRED',
        verifiedAt: expect.any(Date),
      }),
    );
  });

  it('does not expose arbitrary metadata in returned document projections', async () => {
    const repo = repository();

    const result = await new PartnerDocumentService(repo).getDocuments(partnerId, actor);

    expect(result[0]).not.toHaveProperty('metadata');
    expect(result[0]).not.toHaveProperty('sensitiveIdentifier');
  });
});
