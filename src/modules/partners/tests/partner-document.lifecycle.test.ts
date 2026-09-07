import { describe, expect, it, vi } from 'vitest';
import { PartnerDocumentService } from '../services/partner-document.service.js';
import type { PartnerDocumentRepository } from '../repositories/partner-document.repository.js';
import type { PartnerDocument, PartnerDocumentStatus } from '../types/partner-document.js';

const partnerId = '650e8400-e29b-41d4-a716-446655440000';
const ownerId = '550e8400-e29b-41d4-a716-446655440000';
const documentId = '750e8400-e29b-41d4-a716-446655440000';
const owner = { userId: ownerId, role: 'customer' } as const;
const admin = { userId: '450e8400-e29b-41d4-a716-446655440000', role: 'admin' } as const;

function makeDocument(status: PartnerDocumentStatus, expiresAt = '2099-01-01'): PartnerDocument {
  return {
    id: documentId,
    partnerId,
    vehicleId: null,
    documentType: 'PAN',
    status,
    issuedAt: '2020-01-01',
    expiresAt,
    uploadedAt: new Date('2026-01-01'),
    verifiedAt: status === 'VERIFIED' || status === 'EXPIRED' ? new Date('2026-01-02') : null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function repository(current: PartnerDocument, ownerIdValue = ownerId): PartnerDocumentRepository {
  return {
    partnerExists: vi.fn().mockResolvedValue(true),
    partnerOwnerId: vi.fn().mockResolvedValue(ownerIdValue),
    vehicleBelongsToPartner: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(current),
    findByPartner: vi.fn().mockResolvedValue([current]),
    findById: vi.fn().mockResolvedValue(current),
    update: vi.fn().mockImplementation(async (_id, _partnerId, data) => ({
      ...current,
      ...data,
      status: data.status ?? current.status,
    })),
  };
}

const validTransitions: Array<[PartnerDocumentStatus, PartnerDocumentStatus]> = [
  ['PENDING', 'SUBMITTED'],
  ['SUBMITTED', 'VERIFIED'],
  ['SUBMITTED', 'REJECTED'],
  ['REJECTED', 'SUBMITTED'],
  ['VERIFIED', 'EXPIRED'],
];

describe('Partner document lifecycle matrix', () => {
  it.each(validTransitions)('allows %s -> %s', async (from, to) => {
    const current = makeDocument(from, to === 'EXPIRED' ? '2020-01-01' : '2099-01-01');
    const repo = repository(current);
    await new PartnerDocumentService(repo).updateDocumentMetadata(
      partnerId,
      documentId,
      { status: to },
      owner,
    );
    expect(repo.update).toHaveBeenCalledWith(
      documentId,
      partnerId,
      expect.objectContaining({ status: to }),
    );
  });

  const invalidTransitions: Array<[PartnerDocumentStatus, PartnerDocumentStatus]> = [
    ['PENDING', 'VERIFIED'],
    ['PENDING', 'REJECTED'],
    ['PENDING', 'EXPIRED'],
    ['SUBMITTED', 'EXPIRED'],
    ['SUBMITTED', 'PENDING'],
    ['VERIFIED', 'REJECTED'],
    ['VERIFIED', 'SUBMITTED'],
    ['REJECTED', 'VERIFIED'],
    ['REJECTED', 'EXPIRED'],
    ['EXPIRED', 'PENDING'],
    ['EXPIRED', 'SUBMITTED'],
  ];

  it.each(invalidTransitions)('rejects %s -> %s', async (from, to) => {
    const repo = repository(makeDocument(from));
    await expect(
      new PartnerDocumentService(repo).updateDocumentMetadata(
        partnerId,
        documentId,
        { status: to },
        owner,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_STATUS_TRANSITION', statusCode: 400 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each([
    ['VERIFIED', '2020-01-01'],
    ['EXPIRED', '2099-01-01'],
    ['EXPIRED', null],
  ] as const)('rejects inconsistent expiry for %s with expiry %s', async (status, expiresAt) => {
    const repo = repository(makeDocument(status, expiresAt ?? '2099-01-01'));
    await expect(
      new PartnerDocumentService(repo).updateDocumentMetadata(
        partnerId,
        documentId,
        { expiresAt, status },
        owner,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_EXPIRY', statusCode: 400 });
  });

  it('allows a verified document with a future expiry date', async () => {
    const repo = repository(makeDocument('VERIFIED', '2099-01-01'));
    await expect(
      new PartnerDocumentService(repo).updateDocumentMetadata(
        partnerId,
        documentId,
        { status: 'VERIFIED', expiresAt: '2099-01-01' },
        owner,
      ),
    ).resolves.toBeDefined();
  });

  it('allows an admin to update a partner document without partner ownership', async () => {
    const repo = repository(makeDocument('SUBMITTED'), ownerId);
    await new PartnerDocumentService(repo).updateDocumentMetadata(
      partnerId,
      documentId,
      { status: 'REJECTED' },
      admin,
    );
    expect(repo.update).toHaveBeenCalled();
  });

  it('rejects a non-owner from reading documents', async () => {
    const repo = repository(makeDocument('PENDING'), ownerId);
    await expect(
      new PartnerDocumentService(repo).getDocuments(partnerId, {
        userId: '660e8400-e29b-41d4-a716-446655440000',
        role: 'customer',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(repo.findByPartner).not.toHaveBeenCalled();
  });

  it('returns not found when the partner owner record is absent', async () => {
    const repo = repository(makeDocument('PENDING'));
    vi.mocked(repo.partnerOwnerId).mockResolvedValue(null);
    await expect(
      new PartnerDocumentService(repo).getDocuments(partnerId, owner),
    ).rejects.toMatchObject({ code: 'PARTNER_NOT_FOUND', statusCode: 404 });
  });

  it('returns not found when the document disappears before update', async () => {
    const repo = repository(makeDocument('PENDING'));
    vi.mocked(repo.findById).mockResolvedValue(null);
    await expect(
      new PartnerDocumentService(repo).updateDocumentMetadata(
        partnerId,
        documentId,
        { status: 'SUBMITTED' },
        owner,
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND', statusCode: 404 });
  });

  it('requires new documents to begin in pending status', async () => {
    const repo = repository(makeDocument('PENDING'));
    await expect(
      new PartnerDocumentService(repo).createDocumentMetadata(
        partnerId,
        { documentType: 'PAN', status: 'VERIFIED' },
        owner,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_STATUS_TRANSITION', statusCode: 400 });
    expect(repo.create).not.toHaveBeenCalled();
  });
});
