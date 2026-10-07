import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signAccessToken } from '../../auth/utils/jwt.js';
import { createPartnerDocumentStorageRouter } from '../routes/partner-document-storage.routes.js';
import { PartnerDocumentStorageController } from '../controllers/partner-document-storage.controller.js';
import type { PartnerDocumentStorageService } from '../services/partner-document-storage.service.js';
import type { PartnerDocument } from '../types/partner-document.js';

const partnerId = '550e8400-e29b-41d4-a716-446655440000';

const documentId = '750e8400-e29b-41d4-a716-446655440000';

const userId = '650e8400-e29b-41d4-a716-446655440000';

const accessUrl =
  'https://res.cloudinary.com/example/image/upload/s--signed-document--/document.pdf';

function createDocument(overrides: Partial<PartnerDocument> = {}): PartnerDocument {
  return {
    id: documentId,
    partnerId,
    vehicleId: null,
    documentType: 'AADHAAR',
    status: 'PENDING',
    metadata: {
      storage: {
        storageProvider: 'cloudinary',
        storageKey: 'infurnus/partners/test/documents/aadhaar/document',
        resourceType: 'raw',
        accessMode: 'authenticated',
        mimeType: 'application/pdf',
        fileSize: 1024,
        originalFileName: 'aadhaar.pdf',
      },
      uploadedBy: userId,
    },
    issuedAt: null,
    expiresAt: null,
    uploadedAt: new Date(),
    verifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createServiceMock() {
  return {
    uploadDocument: vi.fn(),
    getDocument: vi.fn(),
    getDocumentAccessUrl: vi.fn(),
    deleteDocumentStorage: vi.fn(),
  } as unknown as PartnerDocumentStorageService;
}

function createApp(service: PartnerDocumentStorageService) {
  const app = express();

  app.use(express.json());

  const controller = new PartnerDocumentStorageController(service);

  app.use('/partners/:id/documents', createPartnerDocumentStorageRouter(controller));

  return app;
}

async function createAccessToken(role: 'fleet_owner' | 'admin' | 'super_admin') {
  return signAccessToken({
    sub: userId,
    role,
    type: 'access',
  });
}

describe('Partner document storage access URL API', () => {
  let service: PartnerDocumentStorageService;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();

    service = createServiceMock();

    app = createApp(service);

    vi.mocked(service.getDocument).mockResolvedValue(createDocument());

    vi.mocked(service.getDocumentAccessUrl).mockResolvedValue(accessUrl);
  });

  it('returns 401 when requesting an access URL without authentication', async () => {
    const response = await request(app).get(
      `/partners/${partnerId}/documents/${documentId}/access-url`,
    );

    expect(response.status).toBe(401);

    expect(service.getDocument).not.toHaveBeenCalled();

    expect(service.getDocumentAccessUrl).not.toHaveBeenCalled();
  });

  it('returns an access URL for an authenticated admin', async () => {
    const token = await createAccessToken('admin');

    const response = await request(app)
      .get(`/partners/${partnerId}/documents/${documentId}/access-url`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        url: accessUrl,
        expiresIn: 300,
      },
    });

    expect(service.getDocument).toHaveBeenCalledWith(
      partnerId,
      documentId,
      expect.objectContaining({
        userId,
        role: 'admin',
      }),
    );

    expect(service.getDocumentAccessUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        id: documentId,
        partnerId,
      }),
      expect.objectContaining({
        userId,
        role: 'admin',
      }),
    );
  });

  it('returns an access URL for an authenticated super admin', async () => {
    const token = await createAccessToken('super_admin');

    const response = await request(app)
      .get(`/partners/${partnerId}/documents/${documentId}/access-url`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        url: accessUrl,
        expiresIn: 300,
      },
    });

    expect(service.getDocumentAccessUrl).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when the storage service rejects sensitive document access', async () => {
    const token = await createAccessToken('fleet_owner');

    const forbiddenError = new Error('You do not have permission to access this document');

    Object.assign(forbiddenError, {
      code: 'FORBIDDEN',
      statusCode: 403,
    });

    vi.mocked(service.getDocumentAccessUrl).mockRejectedValue(forbiddenError);

    const response = await request(app)
      .get(`/partners/${partnerId}/documents/${documentId}/access-url`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);

    expect(service.getDocument).toHaveBeenCalledWith(
      partnerId,
      documentId,
      expect.objectContaining({
        userId,
        role: 'fleet_owner',
      }),
    );

    expect(service.getDocumentAccessUrl).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the document does not belong to the partner', async () => {
    const token = await createAccessToken('admin');

    const notFoundError = new Error('Document not found');

    Object.assign(notFoundError, {
      code: 'DOCUMENT_NOT_FOUND',
      statusCode: 404,
    });

    vi.mocked(service.getDocument).mockRejectedValue(notFoundError);

    const response = await request(app)
      .get(`/partners/${partnerId}/documents/${documentId}/access-url`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);

    expect(service.getDocumentAccessUrl).not.toHaveBeenCalled();
  });

  it('returns 404 when document storage metadata is unavailable', async () => {
    const token = await createAccessToken('admin');

    const storageNotFoundError = new Error('Document storage information is unavailable');

    Object.assign(storageNotFoundError, {
      code: 'DOCUMENT_STORAGE_NOT_FOUND',
      statusCode: 404,
    });

    vi.mocked(service.getDocumentAccessUrl).mockRejectedValue(storageNotFoundError);

    const response = await request(app)
      .get(`/partners/${partnerId}/documents/${documentId}/access-url`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);

    expect(service.getDocument).toHaveBeenCalledTimes(1);

    expect(service.getDocumentAccessUrl).toHaveBeenCalledTimes(1);
  });

  it('passes the complete document returned by the document service to the storage service', async () => {
    const token = await createAccessToken('admin');

    const document = createDocument();

    vi.mocked(service.getDocument).mockResolvedValue(document);

    const response = await request(app)
      .get(`/partners/${partnerId}/documents/${documentId}/access-url`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    expect(service.getDocumentAccessUrl).toHaveBeenCalledWith(
      document,
      expect.objectContaining({
        userId,
        role: 'admin',
      }),
    );
  });
});
