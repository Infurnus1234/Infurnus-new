import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { PartnerDocumentRepository } from '../repositories/partner-document.repository.js';
import type { PartnerDocument } from '../types/partner-document.js';

const partnerId = '650e8400-e29b-41d4-a716-446655440000';
const ownerId = '550e8400-e29b-41d4-a716-446655440000';
const documentId = '750e8400-e29b-41d4-a716-446655440000';
const vehicleId = '850e8400-e29b-41d4-a716-446655440000';

const document: PartnerDocument = {
  id: documentId,
  partnerId,
  vehicleId: null,
  documentType: 'PAN',
  status: 'PENDING',
  issuedAt: null,
  expiresAt: null,
  uploadedAt: new Date('2026-01-01'),
  verifiedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

function token(role: string, userId = ownerId) {
  return signAccessToken({ sub: userId, role, type: 'access' });
}

function repository(): PartnerDocumentRepository {
  return {
    partnerExists: vi.fn().mockResolvedValue(true),
    partnerOwnerId: vi.fn().mockResolvedValue(ownerId),
    vehicleBelongsToPartner: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(document),
    findByPartner: vi.fn().mockResolvedValue([document]),
    findById: vi.fn().mockResolvedValue(document),
    update: vi.fn().mockResolvedValue({ ...document, status: 'SUBMITTED' }),
  };
}

describe('Partner document API route matrix', () => {
  it.each([
    ['GET', `/partners/${partnerId}/documents`],
    ['POST', `/partners/${partnerId}/documents`],
    ['PATCH', `/partners/${partnerId}/documents/${documentId}`],
  ])('returns 401 for unauthenticated %s %s', async (method, path) => {
    const app = createApp(undefined, undefined, undefined, repository());
    const response =
      method === 'GET'
        ? await request(app).get(path)
        : method === 'POST'
          ? await request(app).post(path).send({ documentType: 'PAN' })
          : await request(app).patch(path).send({ status: 'SUBMITTED' });
    expect(response.status).toBe(401);
  });

  it('lists safe document projections for the owner', async () => {
    const app = createApp(undefined, undefined, undefined, repository());
    const accessToken = await token('customer');
    const response = await request(app)
      .get(`/partners/${partnerId}/documents`)
      .set('authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data[0]).not.toHaveProperty('metadata');
    expect(response.body.data[0]).not.toHaveProperty('documentNumber');
  });

  it('creates safe document metadata for the owner', async () => {
    const repo = repository();
    const app = createApp(undefined, undefined, undefined, repo);
    const accessToken = await token('customer');
    const response = await request(app)
      .post(`/partners/${partnerId}/documents`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({ documentType: 'PAN', issuedAt: '2026-01-01' });
    expect(response.status).toBe(201);
    expect(repo.create).toHaveBeenCalled();
    expect(response.body.data).not.toHaveProperty('metadata');
  });

  it('updates document lifecycle metadata for the owner', async () => {
    const app = createApp(undefined, undefined, undefined, repository());
    const accessToken = await token('customer');
    const response = await request(app)
      .patch(`/partners/${partnerId}/documents/${documentId}`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({ status: 'SUBMITTED' });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('SUBMITTED');
  });

  it('allows admins to inspect partner documents', async () => {
    const app = createApp(undefined, undefined, undefined, repository());
    const accessToken = await token('admin', '950e8400-e29b-41d4-a716-446655440000');
    expect(
      (
        await request(app)
          .get(`/partners/${partnerId}/documents`)
          .set('authorization', `Bearer ${accessToken}`)
      ).status,
    ).toBe(200);
  });

  it('rejects an outsider from partner documents', async () => {
    const app = createApp(undefined, undefined, undefined, repository());
    const accessToken = await token('customer', '960e8400-e29b-41d4-a716-446655440000');
    const response = await request(app)
      .get(`/partners/${partnerId}/documents`)
      .set('authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(403);
  });

  it.each([
    ['get', `/partners/not-a-uuid/documents`],
    ['patch', `/partners/${partnerId}/documents/not-a-uuid`],
  ] as const)('rejects invalid document route id %s', async (method, path) => {
    const app = createApp(undefined, undefined, undefined, repository());
    const accessToken = await token('customer');
    const response =
      method === 'get'
        ? await request(app).get(path).set('authorization', `Bearer ${accessToken}`)
        : await request(app)
            .patch(path)
            .set('authorization', `Bearer ${accessToken}`)
            .send({ status: 'SUBMITTED' });
    expect(response.status).toBe(400);
  });

  it('rejects unknown document fields', async () => {
    const app = createApp(undefined, undefined, undefined, repository());
    const accessToken = await token('customer');
    const response = await request(app)
      .post(`/partners/${partnerId}/documents`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({ documentType: 'PAN', documentNumber: 'forbidden' });
    expect(response.status).toBe(400);
  });

  it('rejects invalid vehicle ownership without inserting', async () => {
    const repo = repository();
    vi.mocked(repo.vehicleBelongsToPartner).mockResolvedValue(false);
    const app = createApp(undefined, undefined, undefined, repo);
    const accessToken = await token('customer');
    const response = await request(app)
      .post(`/partners/${partnerId}/documents`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({ vehicleId, documentType: 'VEHICLE_RC' });
    expect(response.status).toBe(404);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('maps duplicate document creation to conflict', async () => {
    const repo = repository();
    vi.mocked(repo.create).mockRejectedValue({ code: '23505' });
    const app = createApp(undefined, undefined, undefined, repo);
    const accessToken = await token('customer');
    const response = await request(app)
      .post(`/partners/${partnerId}/documents`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({ documentType: 'PAN' });
    expect(response.status).toBe(409);
  });

  it('returns not found for a missing document update', async () => {
    const repo = repository();
    vi.mocked(repo.findById).mockResolvedValue(null);
    const app = createApp(undefined, undefined, undefined, repo);
    const accessToken = await token('customer');
    const response = await request(app)
      .patch(`/partners/${partnerId}/documents/${documentId}`)
      .set('authorization', `Bearer ${accessToken}`)
      .send({ status: 'SUBMITTED' });
    expect(response.status).toBe(404);
  });
});
