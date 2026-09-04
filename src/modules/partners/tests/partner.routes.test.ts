import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import type { PartnerRepository } from '../repositories/partner.repository.js';
import type {
  CreatePartnerData,
  Partner,
  PartnerApprovalStatus,
  PartnerAvailabilityStatus,
  UpdatePartnerData,
} from '../types/partner.js';

const partner: Partner = {
  id: '650e8400-e29b-41d4-a716-446655440000',
  userId: '550e8400-e29b-41d4-a716-446655440000',
  businessName: 'Ada Transport',
  businessDescription: 'Local transport services',
  approvalStatus: 'pending',
  availabilityStatus: 'offline',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

class InMemoryPartnerRepository implements PartnerRepository {
  private readonly partners = new Map([[partner.id, partner]]);

  async create(data: CreatePartnerData) {
    const created: Partner = {
      ...partner,
      id: crypto.randomUUID(),
      userId: data.userId,
      businessName: data.businessName,
      businessDescription: data.businessDescription ?? null,
    };
    this.partners.set(created.id, created);
    return created;
  }

  async findById(id: string) {
    return this.partners.get(id) ?? null;
  }

  async findAll(filters: {
    approvalStatus?: PartnerApprovalStatus;
    availabilityStatus?: PartnerAvailabilityStatus;
  }) {
    return [...this.partners.values()].filter(
      (value) =>
        (!filters.approvalStatus || value.approvalStatus === filters.approvalStatus) &&
        (!filters.availabilityStatus || value.availabilityStatus === filters.availabilityStatus),
    );
  }

  async update(id: string, data: UpdatePartnerData) {
    const existing = this.partners.get(id);
    if (!existing) return null;
    const updated: Partner = {
      ...existing,
      businessName: data.businessName ?? existing.businessName,
      businessDescription: data.businessDescription ?? existing.businessDescription,
      availabilityStatus: data.availabilityStatus ?? existing.availabilityStatus,
      updatedAt: new Date(),
    };
    this.partners.set(id, updated);
    return updated;
  }
}

describe('Partners API', () => {
  it('creates, lists, retrieves, and updates a partner', async () => {
    const app = createApp(undefined, new InMemoryPartnerRepository());
    const created = await request(app).post('/partners').send({
      userId: partner.userId,
      businessName: 'Grace Logistics',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.rejectionReason).toBeUndefined();
    const partnerId = created.body.data.id;
    expect((await request(app).get('/partners')).body.data.length).toBe(2);
    expect((await request(app).get(`/partners/${partnerId}`)).status).toBe(200);
    const updated = await request(app).patch(`/partners/${partnerId}`).send({
      availabilityStatus: 'available',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.availabilityStatus).toBe('available');
  });

  it('rejects invalid input and missing partners', async () => {
    const app = createApp(undefined, new InMemoryPartnerRepository());
    expect(
      (await request(app).post('/partners').send({ businessName: 'Missing user' })).status,
    ).toBe(400);
    expect((await request(app).get('/partners/not-a-uuid')).status).toBe(400);
    const missing = await request(app).get('/partners/650e8400-e29b-41d4-a716-446655440001');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PARTNER_NOT_FOUND');
  });
});
