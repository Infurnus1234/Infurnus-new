import { describe, expect, it, vi } from 'vitest';

import { PartnerDriverService } from '../services/partner-driver.service.js';

import type { AuthenticatedUser } from '../../auth/types/auth.js';
import type { PartnerRepository } from '../repositories/partner.repository.js';
import type { PartnerDriverRepository } from '../repositories/partner-driver.repository.js';

const partnerId = '150e8400-e29b-41d4-a716-446655440000';
const userId = '250e8400-e29b-41d4-a716-446655440000';
const relationshipId = '450e8400-e29b-41d4-a716-446655440000';

const actor: AuthenticatedUser = {
  userId,
  role: 'fleet_owner',
};

const approvedPartner = {
  id: partnerId,
  userId,
  businessName: 'ABC Travels',
  businessDescription: null,
  approvalStatus: 'approved' as const,
  availabilityStatus: 'offline' as const,
  reviewedAt: new Date('2026-09-01T10:00:00.000Z'),
  reviewedBy: '550e8400-e29b-41d4-a716-446655440000',
  approvedAt: new Date('2026-09-01T10:00:00.000Z'),
  approvedBy: '550e8400-e29b-41d4-a716-446655440000',
  createdAt: new Date('2026-08-20T10:00:00.000Z'),
  updatedAt: new Date('2026-09-01T10:00:00.000Z'),
};

const relationship = {
  id: relationshipId,
  partnerId,
  driverProfileId: '350e8400-e29b-41d4-a716-446655440000',
  status: 'ACTIVE' as const,
  createdAt: new Date('2026-09-10T10:00:00.000Z'),
  updatedAt: new Date('2026-09-10T10:00:00.000Z'),
};

function partnerRepository(overrides: Partial<PartnerRepository> = {}): PartnerRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByUserId: vi.fn().mockResolvedValue(approvedPartner),
    findAll: vi.fn(),
    update: vi.fn(),
    review: vi.fn(),
    ...overrides,
  };
}

function partnerDriverRepository(
  overrides: Partial<PartnerDriverRepository> = {},
): PartnerDriverRepository {
  return {
    create: vi.fn().mockResolvedValue(relationship),
    findById: vi.fn().mockResolvedValue(relationship),
    findByPartnerAndDriver: vi.fn().mockResolvedValue(null),
    listByPartner: vi.fn().mockResolvedValue([]),
    listByDriver: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn().mockResolvedValue(relationship),
    ...overrides,
  };
}

function createService(options?: {
  partner?: Partial<PartnerRepository>;
  relationship?: Partial<PartnerDriverRepository>;
}) {
  return new PartnerDriverService(
    partnerRepository(options?.partner),
    partnerDriverRepository(options?.relationship),
  );
}

describe('PartnerDriverService', () => {
  it('requires the partner to be approved before listing drivers', async () => {
    const service = createService({
      partner: {
        findByUserId: vi.fn().mockResolvedValue({
          ...approvedPartner,
          approvalStatus: 'pending',
        }),
      },
    });

    await expect(service.listDrivers(actor)).rejects.toMatchObject({
      code: 'PARTNER_NOT_APPROVED',
    });
  });

  it('rejects when partner profile does not exist', async () => {
    const service = createService({
      partner: {
        findByUserId: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(service.listDrivers(actor)).rejects.toMatchObject({
      code: 'PARTNER_NOT_FOUND',
    });
  });

  it('lists drivers for the authenticated partner', async () => {
    const relationships = [
      relationship,
      {
        ...relationship,
        id: '750e8400-e29b-41d4-a716-446655440000',
        driverProfileId: '850e8400-e29b-41d4-a716-446655440000',
      },
    ];

    const listByPartner = vi.fn().mockResolvedValue(relationships);

    const service = createService({
      relationship: {
        listByPartner,
      },
    });

    const result = await service.listDrivers(actor);

    expect(listByPartner).toHaveBeenCalledWith(partnerId, undefined);

    expect(result).toEqual(relationships);
  });

  it('lists drivers with a status filter', async () => {
    const listByPartner = vi.fn().mockResolvedValue([]);

    const service = createService({
      relationship: {
        listByPartner,
      },
    });

    await service.listDrivers(actor, 'ACTIVE');

    expect(listByPartner).toHaveBeenCalledWith(partnerId, 'ACTIVE');
  });

  it('rejects status updates for a missing relationship', async () => {
    const service = createService({
      relationship: {
        findById: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(service.updateStatus(actor, relationshipId, 'INACTIVE')).rejects.toMatchObject({
      code: 'PARTNER_DRIVER_NOT_FOUND',
    });
  });

  it('prevents a partner from updating another partner relationship', async () => {
    const service = createService({
      relationship: {
        findById: vi.fn().mockResolvedValue({
          ...relationship,
          partnerId: '950e8400-e29b-41d4-a716-446655440000',
        }),
      },
    });

    await expect(service.updateStatus(actor, relationshipId, 'INACTIVE')).rejects.toMatchObject({
      code: 'PARTNER_DRIVER_FORBIDDEN',
    });
  });

  it('allows a partner to deactivate its own relationship', async () => {
    const updatedRelationship = {
      ...relationship,
      status: 'INACTIVE' as const,
    };

    const updateStatus = vi.fn().mockResolvedValue(updatedRelationship);

    const service = createService({
      relationship: {
        findById: vi.fn().mockResolvedValue(relationship),
        updateStatus,
      },
    });

    const result = await service.updateStatus(actor, relationshipId, 'INACTIVE');

    expect(updateStatus).toHaveBeenCalledWith(relationshipId, 'INACTIVE');

    expect(result).toEqual(updatedRelationship);
  });

  it('prevents a partner from activating a relationship', async () => {
    const service = createService({
      relationship: {
        findById: vi.fn().mockResolvedValue({
          ...relationship,
          status: 'INACTIVE' as const,
        }),
      },
    });

    await expect(service.updateStatus(actor, relationshipId, 'ACTIVE')).rejects.toMatchObject({
      code: 'PARTNER_DRIVER_STATUS_FORBIDDEN',
    });
  });

  it('prevents a partner from activating an inactive relationship', async () => {
    const updateStatus = vi.fn();

    const service = createService({
      relationship: {
        updateStatus,
      },
    });

    await expect(service.updateStatus(actor, relationshipId, 'ACTIVE')).rejects.toMatchObject({
      code: 'PARTNER_DRIVER_STATUS_FORBIDDEN',
    });

    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('throws when status update returns no relationship', async () => {
    const service = createService({
      relationship: {
        findById: vi.fn().mockResolvedValue(relationship),
        updateStatus: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(service.updateStatus(actor, relationshipId, 'INACTIVE')).rejects.toMatchObject({
      code: 'PARTNER_DRIVER_NOT_FOUND',
    });
  });

  it('does not create a driver relationship from PartnerDriverService', () => {
    const service = createService();

    expect('createRelationship' in service).toBe(false);
  });
});
