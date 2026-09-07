import { describe, expect, it, vi } from 'vitest';
import { PartnerService } from '../services/partner.service.js';
import type { PartnerRepository } from '../repositories/partner.repository.js';
import type { Partner } from '../types/partner.js';

const ownerId = '550e8400-e29b-41d4-a716-446655440000';
const partnerId = '650e8400-e29b-41d4-a716-446655440000';
const partner: Partner = {
  id: partnerId,
  userId: ownerId,
  businessName: 'Ada Transport',
  businessDescription: null,
  approvalStatus: 'pending',
  availabilityStatus: 'offline',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function repository(): PartnerRepository {
  return {
    create: vi.fn().mockResolvedValue(partner),
    findById: vi.fn().mockResolvedValue(partner),
    findAll: vi.fn().mockResolvedValue([partner]),
    update: vi.fn().mockResolvedValue(partner),
  };
}

const owner = { userId: ownerId, role: 'customer' } as const;
const admin = { userId: '750e8400-e29b-41d4-a716-446655440000', role: 'admin' } as const;
const outsider = { userId: '850e8400-e29b-41d4-a716-446655440000', role: 'customer' } as const;

describe('PartnerService authorization and failure matrix', () => {
  it('allows the owner to create a matching partner', async () => {
    const repo = repository();
    await expect(
      new PartnerService(repo).createPartner(
        { userId: ownerId, businessName: 'Ada Transport' },
        owner,
      ),
    ).resolves.toEqual(partner);
  });

  it('allows admins to create a partner for another user', async () => {
    await expect(
      new PartnerService(repository()).createPartner(
        { userId: ownerId, businessName: 'Admin Created' },
        admin,
      ),
    ).resolves.toEqual(partner);
  });

  it('rejects an owner creating a partner for another user', async () => {
    await expect(
      new PartnerService(repository()).createPartner(
        { userId: '950e8400-e29b-41d4-a716-446655440000', businessName: 'Wrong Owner' },
        owner,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('maps duplicate partner creation to conflict', async () => {
    const repo = repository();
    vi.mocked(repo.create).mockRejectedValue({ code: '23505' });
    await expect(
      new PartnerService(repo).createPartner({ userId: ownerId, businessName: 'Duplicate' }, owner),
    ).rejects.toMatchObject({ code: 'PARTNER_ALREADY_EXISTS', statusCode: 409 });
  });

  it('maps missing user foreign key to not found', async () => {
    const repo = repository();
    vi.mocked(repo.create).mockRejectedValue({ code: '23503' });
    await expect(
      new PartnerService(repo).createPartner(
        { userId: ownerId, businessName: 'Missing User' },
        owner,
      ),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
  });

  it('allows owner profile reads', async () => {
    await expect(new PartnerService(repository()).getPartner(partnerId, owner)).resolves.toEqual(
      partner,
    );
  });

  it('allows admin profile reads', async () => {
    await expect(new PartnerService(repository()).getPartner(partnerId, admin)).resolves.toEqual(
      partner,
    );
  });

  it('rejects outsider profile reads', async () => {
    await expect(
      new PartnerService(repository()).getPartner(partnerId, outsider),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('returns not found for missing profile reads', async () => {
    const repo = repository();
    vi.mocked(repo.findById).mockResolvedValue(null);
    await expect(new PartnerService(repo).getPartner(partnerId, owner)).rejects.toMatchObject({
      code: 'PARTNER_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('allows admin partner listing with filters', async () => {
    const repo = repository();
    await expect(
      new PartnerService(repo).listPartners({ approvalStatus: 'approved' }, admin),
    ).resolves.toEqual([partner]);
    expect(repo.findAll).toHaveBeenCalledWith({ approvalStatus: 'approved' });
  });

  it('rejects owner partner listing', async () => {
    await expect(new PartnerService(repository()).listPartners({}, owner)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('rejects driver partner listing', async () => {
    await expect(
      new PartnerService(repository()).listPartners({}, { userId: ownerId, role: 'driver' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('allows owner updates', async () => {
    await expect(
      new PartnerService(repository()).updatePartner(
        partnerId,
        { availabilityStatus: 'available' },
        owner,
      ),
    ).resolves.toEqual(partner);
  });

  it('allows admin updates', async () => {
    await expect(
      new PartnerService(repository()).updatePartner(partnerId, { businessName: 'Updated' }, admin),
    ).resolves.toEqual(partner);
  });

  it('rejects outsider updates', async () => {
    await expect(
      new PartnerService(repository()).updatePartner(
        partnerId,
        { businessName: 'Hijack' },
        outsider,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('does not update when the target partner is missing', async () => {
    const repo = repository();
    vi.mocked(repo.findById).mockResolvedValue(null);
    await expect(
      new PartnerService(repo).updatePartner(partnerId, { businessName: 'Missing' }, owner),
    ).rejects.toMatchObject({ code: 'PARTNER_NOT_FOUND', statusCode: 404 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('returns not found when update loses the row', async () => {
    const repo = repository();
    vi.mocked(repo.update).mockResolvedValue(null);
    await expect(
      new PartnerService(repo).updatePartner(partnerId, { businessName: 'Race' }, owner),
    ).rejects.toMatchObject({ code: 'PARTNER_NOT_FOUND', statusCode: 404 });
  });

  it.each(['offline', 'available', 'unavailable'] as const)(
    'accepts availability state %s through update service',
    async (availabilityStatus) => {
      const repo = repository();
      await expect(
        new PartnerService(repo).updatePartner(partnerId, { availabilityStatus }, owner),
      ).resolves.toEqual(partner);
      expect(repo.update).toHaveBeenCalledWith(partnerId, { availabilityStatus });
    },
  );
});
