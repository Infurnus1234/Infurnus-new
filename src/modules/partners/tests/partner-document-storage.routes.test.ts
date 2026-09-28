import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storageService } from '../../../infrastructure/storage/index.js';
import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { PartnerDocumentRepository } from '../repositories/partner-document.repository.js';
import type { PartnerDocument } from '../types/partner-document.js';

vi.mock('../../../infrastructure/storage/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../infrastructure/storage/index.js')>(
    '../../../infrastructure/storage/index.js',
  );

  return {
    ...actual,
    storageService: {
      ...actual.storageService,
      upload: vi.fn(),
      delete: vi.fn(),
      getAccessUrl: vi.fn(),
    },
  };
});

describe('Partner document storage upload API', () => {
  const partnerId = '550e8400-e29b-41d4-a716-446655440000';
  const ownerId = '650e8400-e29b-41d4-a716-446655440000';
  const vehicleId = '750e8400-e29b-41d4-a716-446655440000';
  const documentId = '850e8400-e29b-41d4-a716-446655440000';

  const uploadedStorageKey =
    'infurnus/partners/550e8400-e29b-41d4-a716-446655440000/documents/pan/test-file';

  const document: PartnerDocument = {
    id: documentId,
    partnerId,
    vehicleId: null,
    documentType: 'PAN',
    status: 'PENDING',
    metadata: {
      storage: {
        storageProvider: 'cloudinary',
        storageKey: uploadedStorageKey,
        resourceType: 'raw',
        accessMode: 'authenticated',
        mimeType: 'application/pdf',
        fileSize: 1024,
        originalFileName: 'pan.pdf',
      },
      uploadedBy: ownerId,
    },
    issuedAt: null,
    expiresAt: null,
    uploadedAt: new Date(),
    verifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const repo = {
    partnerExists: vi.fn().mockResolvedValue(true),
    partnerOwnerId: vi.fn().mockResolvedValue(ownerId),
    vehicleBelongsToPartner: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue(document),
    findByPartner: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    delete: vi.fn(),
  } satisfies PartnerDocumentRepository;

  const mockStorageUpload = vi.mocked(storageService.upload);
  const mockStorageDelete = vi.mocked(storageService.delete);
  const mockStorageAccessUrl = vi.mocked(storageService.getAccessUrl);

  let app: ReturnType<typeof createApp>;

  async function createAuthenticatedToken(): Promise<string> {
    return signAccessToken({
      sub: ownerId,
      role: 'driver',
      type: 'access',
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();

    repo.partnerExists.mockResolvedValue(true);
    repo.partnerOwnerId.mockResolvedValue(ownerId);
    repo.vehicleBelongsToPartner.mockResolvedValue(true);
    repo.create.mockResolvedValue(document);
    repo.findByPartner.mockResolvedValue([]);
    repo.findById.mockResolvedValue(null);

    mockStorageUpload.mockResolvedValue({
      storageProvider: 'cloudinary',
      storageKey: uploadedStorageKey,
      resourceType: 'raw',
      accessMode: 'authenticated',
      mimeType: 'application/pdf',
      fileSize: 1024,
    });

    mockStorageDelete.mockResolvedValue(undefined);

    mockStorageAccessUrl.mockResolvedValue('https://example.com/document');

    app = createApp(undefined, undefined, undefined, repo);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 when uploading without authentication', async () => {
    const response = await request(app)
      .post(`/partners/${partnerId}/documents/upload`)
      .attach('file', Buffer.from('%PDF-1.7\n'), {
        filename: 'pan.pdf',
        contentType: 'application/pdf',
      })
      .field('documentType', 'PAN');

    expect(response.status).toBe(401);
  });

  it('uploads a partner document through the storage service', async () => {
    const token = await createAuthenticatedToken();

    const response = await request(app)
      .post(`/partners/${partnerId}/documents/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.7\n'), {
        filename: 'pan.pdf',
        contentType: 'application/pdf',
      })
      .field('documentType', 'PAN');

    expect(response.status).toBe(201);

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: `infurnus/partners/${partnerId}/documents/pan`,
        resourceType: 'raw',
        accessMode: 'authenticated',
        file: expect.objectContaining({
          mimeType: 'application/pdf',
          originalFileName: 'pan.pdf',
          fileSize: expect.any(Number),
        }),
      }),
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId,
        vehicleId: null,
        documentType: 'PAN',
        status: 'PENDING',
        metadata: expect.objectContaining({
          storage: expect.objectContaining({
            storageProvider: 'cloudinary',
            storageKey: uploadedStorageKey,
            resourceType: 'raw',
            accessMode: 'authenticated',
            mimeType: 'application/pdf',
            fileSize: 1024,
            originalFileName: 'pan.pdf',
          }),
          uploadedBy: ownerId,
        }),
      }),
    );

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: documentId,
          partnerId,
          documentType: 'PAN',
          status: 'PENDING',
        }),
      }),
    );

    expect(response.body.data).not.toHaveProperty('metadata');
  });

  it('uploads a provider profile photo through the storage service', async () => {
    const profilePhotoStorageKey = `infurnus/partners/${partnerId}/documents/profile_photo/profile-photo`;

    const profilePhotoDocument: PartnerDocument = {
      ...document,
      documentType: 'PROFILE_PHOTO',
      vehicleId: null,
      metadata: {
        storage: {
          storageProvider: 'cloudinary',
          storageKey: profilePhotoStorageKey,
          resourceType: 'image',
          accessMode: 'public',
          mimeType: 'image/jpeg',
          fileSize: 1024,
          originalFileName: 'profile.jpg',
        },
        uploadedBy: ownerId,
      },
    };

    repo.create.mockResolvedValue(profilePhotoDocument);

    mockStorageUpload.mockResolvedValue({
      storageProvider: 'cloudinary',
      storageKey: profilePhotoStorageKey,
      resourceType: 'image',
      accessMode: 'public',
      mimeType: 'image/jpeg',
      fileSize: 1024,
    });

    const token = await createAuthenticatedToken();

    const response = await request(app)
      .post(`/partners/${partnerId}/documents/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach(
        'file',
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
        {
          filename: 'profile.jpg',
          contentType: 'image/jpeg',
        },
      )
      .field('documentType', 'PROFILE_PHOTO');

    expect(response.status).toBe(201);

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: `infurnus/partners/${partnerId}/documents/profile_photo`,
        resourceType: 'image',
        accessMode: 'public',
        file: expect.objectContaining({
          mimeType: 'image/jpeg',
          originalFileName: 'profile.jpg',
          fileSize: expect.any(Number),
        }),
      }),
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId,
        vehicleId: null,
        documentType: 'PROFILE_PHOTO',
        status: 'PENDING',
        metadata: expect.objectContaining({
          storage: expect.objectContaining({
            storageProvider: 'cloudinary',
            storageKey: profilePhotoStorageKey,
            resourceType: 'image',
            accessMode: 'public',
            mimeType: 'image/jpeg',
            fileSize: 1024,
            originalFileName: 'profile.jpg',
          }),
          uploadedBy: ownerId,
        }),
      }),
    );

    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: documentId,
          partnerId,
          documentType: 'PROFILE_PHOTO',
          status: 'PENDING',
        }),
      }),
    );

    expect(response.body.data).not.toHaveProperty('metadata');
  });

  it('passes vehicleId when uploading a vehicle document', async () => {
    const vehicleDocument: PartnerDocument = {
      ...document,
      vehicleId,
      documentType: 'VEHICLE_RC',
    };

    repo.create.mockResolvedValue(vehicleDocument);

    const vehicleStorageKey = `infurnus/partners/${partnerId}/documents/vehicle_rc/test-file`;

    mockStorageUpload.mockResolvedValue({
      storageProvider: 'cloudinary',
      storageKey: vehicleStorageKey,
      resourceType: 'raw',
      accessMode: 'authenticated',
      mimeType: 'application/pdf',
      fileSize: 1024,
    });

    const token = await createAuthenticatedToken();

    const response = await request(app)
      .post(`/partners/${partnerId}/documents/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.7\n'), {
        filename: 'vehicle-rc.pdf',
        contentType: 'application/pdf',
      })
      .field('documentType', 'VEHICLE_RC')
      .field('vehicleId', vehicleId);

    expect(response.status).toBe(201);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId,
        vehicleId,
        documentType: 'VEHICLE_RC',
        status: 'PENDING',
      }),
    );

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: `infurnus/partners/${partnerId}/documents/vehicle_rc`,
        resourceType: 'raw',
        accessMode: 'authenticated',
      }),
    );
  });

  it('rejects an invalid document type', async () => {
    const token = await createAuthenticatedToken();

    const response = await request(app)
      .post(`/partners/${partnerId}/documents/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.7\n'), {
        filename: 'invalid.pdf',
        contentType: 'application/pdf',
      })
      .field('documentType', 'INVALID_DOCUMENT');

    expect(response.status).toBe(500);

    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects an upload without a file', async () => {
    const token = await createAuthenticatedToken();

    const response = await request(app)
      .post(`/partners/${partnerId}/documents/upload`)
      .set('Authorization', `Bearer ${token}`)
      .field('documentType', 'PAN');

    expect(response.status).toBe(500);

    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('cleans up Cloudinary storage when database creation fails', async () => {
    const databaseError = new Error('database insert failed');

    repo.create.mockRejectedValue(databaseError);

    const token = await createAuthenticatedToken();

    const response = await request(app)
      .post(`/partners/${partnerId}/documents/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.7\n'), {
        filename: 'pan.pdf',
        contentType: 'application/pdf',
      })
      .field('documentType', 'PAN');

    expect(response.status).toBe(500);

    expect(mockStorageUpload).toHaveBeenCalled();

    expect(mockStorageDelete).toHaveBeenCalledWith({
      storageKey: uploadedStorageKey,
      resourceType: 'raw',
      accessMode: 'authenticated',
    });
  });
});
