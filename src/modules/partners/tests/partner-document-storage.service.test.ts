import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../auth/types/auth.js';
import type { PartnerDocumentService } from '../services/partner-document.service.js';
import {
  PartnerDocumentStorageService,
  type PartnerDocumentUploadFile,
} from '../services/partner-document-storage.service.js';
import type { PartnerDocument } from '../types/partner-document.js';

const { storageUploadMock, storageDeleteMock, storageAccessUrlMock } = vi.hoisted(() => ({
  storageUploadMock: vi.fn(),
  storageDeleteMock: vi.fn(),
  storageAccessUrlMock: vi.fn(),
}));

vi.mock('../../../infrastructure/storage/index.js', () => ({
  storageService: {
    upload: storageUploadMock,
    delete: storageDeleteMock,
    getAccessUrl: storageAccessUrlMock,
  },
}));

const partnerId = '550e8400-e29b-41d4-a716-446655440000';

const userId = '650e8400-e29b-41d4-a716-446655440000';

const actor: AuthenticatedUser = {
  userId,
  role: 'fleet_owner',
};

const adminActor: AuthenticatedUser = {
  userId,
  role: 'admin',
};

function createPdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'ascii');
}

function createJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
}

function createPngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function createWebpBuffer(): Buffer {
  return Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
}

function createPdfFile(): PartnerDocumentUploadFile {
  const buffer = createPdfBuffer();

  return {
    buffer,
    mimetype: 'application/pdf',
    originalname: 'aadhaar.pdf',
    size: buffer.length,
  };
}

function createJpegFile(): PartnerDocumentUploadFile {
  const buffer = createJpegBuffer();

  return {
    buffer,
    mimetype: 'image/jpeg',
    originalname: 'profile.jpg',
    size: buffer.length,
  };
}

function createPngFile(): PartnerDocumentUploadFile {
  const buffer = createPngBuffer();

  return {
    buffer,
    mimetype: 'image/png',
    originalname: 'profile.png',
    size: buffer.length,
  };
}

function createWebpFile(): PartnerDocumentUploadFile {
  const buffer = createWebpBuffer();

  return {
    buffer,
    mimetype: 'image/webp',
    originalname: 'profile.webp',
    size: buffer.length,
  };
}

const file = createPdfFile();

function createDocument(overrides: Partial<PartnerDocument> = {}): PartnerDocument {
  return {
    id: '750e8400-e29b-41d4-a716-446655440000',
    partnerId,
    vehicleId: null,
    documentType: 'AADHAAR',
    status: 'PENDING',
    metadata: {
      storage: {
        storageProvider: 'cloudinary',
        storageKey: 'infurnus/partners/test/aadhaar',
        resourceType: 'raw',
        accessMode: 'authenticated',
        mimeType: 'application/pdf',
        fileSize: file.size,
        originalFileName: file.originalname,
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

function createSafeDocument(
  overrides: Partial<Omit<PartnerDocument, 'metadata'>> = {},
): Omit<PartnerDocument, 'metadata'> {
  const { metadata: _metadata, ...safeDocument } = createDocument();

  return {
    ...safeDocument,
    ...overrides,
  };
}

function createServiceMock() {
  return {
    assertAccess: vi.fn().mockResolvedValue(undefined),
    createDocumentMetadata: vi.fn(),
    getDocument: vi.fn(),
    getDocuments: vi.fn(),
    updateDocumentMetadata: vi.fn(),
    deleteDocument: vi.fn(),
  } as unknown as PartnerDocumentService;
}

describe('PartnerDocumentStorageService', () => {
  let partnerDocumentService: PartnerDocumentService;
  let service: PartnerDocumentStorageService;

  beforeEach(() => {
    vi.clearAllMocks();

    partnerDocumentService = createServiceMock();

    service = new PartnerDocumentStorageService(partnerDocumentService);

    storageUploadMock.mockResolvedValue({
      storageProvider: 'cloudinary',
      storageKey: 'infurnus/partners/550e8400-e29b-41d4-a716-446655440000/documents/aadhaar/test',
      resourceType: 'raw',
      accessMode: 'authenticated',
      mimeType: 'application/pdf',
      fileSize: file.size,
    });

    storageDeleteMock.mockResolvedValue(undefined);

    storageAccessUrlMock.mockResolvedValue('https://secure.example.com/document');
  });

  it('uploads the file and creates partner document metadata', async () => {
    const document = createDocument();

    const safeDocument = createSafeDocument({
      id: document.id,
      partnerId: document.partnerId,
      vehicleId: document.vehicleId,
      documentType: document.documentType,
      status: document.status,
      issuedAt: document.issuedAt,
      expiresAt: document.expiresAt,
      uploadedAt: document.uploadedAt,
      verifiedAt: document.verifiedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    });

    vi.mocked(partnerDocumentService.createDocumentMetadata).mockResolvedValue(safeDocument);

    const result = await service.uploadDocument({
      partnerId,
      documentType: 'AADHAAR',
      file,
      actor,
    });

    expect(storageUploadMock).toHaveBeenCalledTimes(1);

    expect(storageUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({
          buffer: file.buffer,
          mimeType: file.mimetype,
          originalFileName: file.originalname,
          fileSize: file.size,
        }),
        resourceType: 'raw',
        accessMode: 'authenticated',
      }),
    );

    expect(partnerDocumentService.createDocumentMetadata).toHaveBeenCalledWith(
      partnerId,
      expect.objectContaining({
        documentType: 'AADHAAR',
        status: 'PENDING',
        metadata: expect.objectContaining({
          uploadedBy: userId,
          storage: expect.objectContaining({
            storageProvider: 'cloudinary',
            storageKey: expect.any(String),
            resourceType: 'raw',
            accessMode: 'authenticated',
            mimeType: 'application/pdf',
            fileSize: file.size,
            originalFileName: file.originalname,
          }),
        }),
      }),
      actor,
    );

    expect(result).toEqual(safeDocument);

    expect(result).not.toHaveProperty('metadata');
  });

  it('uses authenticated access for profile photo uploads', async () => {
    const profilePhoto = createJpegFile();

    vi.mocked(partnerDocumentService.createDocumentMetadata).mockResolvedValue(
      createSafeDocument({
        documentType: 'PROFILE_PHOTO',
      }),
    );

    await service.uploadDocument({
      partnerId,
      documentType: 'PROFILE_PHOTO',
      file: profilePhoto,
      actor,
    });

    expect(storageUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'image',
        accessMode: 'authenticated',
      }),
    );
  });

  it('accepts a valid PNG profile photo', async () => {
    const profilePhoto = createPngFile();

    vi.mocked(partnerDocumentService.createDocumentMetadata).mockResolvedValue(
      createSafeDocument({
        documentType: 'PROFILE_PHOTO',
      }),
    );

    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'PROFILE_PHOTO',
        file: profilePhoto,
        actor,
      }),
    ).resolves.toBeDefined();

    expect(storageUploadMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid WebP profile photo', async () => {
    const profilePhoto = createWebpFile();

    vi.mocked(partnerDocumentService.createDocumentMetadata).mockResolvedValue(
      createSafeDocument({
        documentType: 'PROFILE_PHOTO',
      }),
    );

    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'PROFILE_PHOTO',
        file: profilePhoto,
        actor,
      }),
    ).resolves.toBeDefined();

    expect(storageUploadMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a fake JPEG profile photo', async () => {
    const buffer = Buffer.from('not-a-real-jpeg');

    const fakeFile: PartnerDocumentUploadFile = {
      buffer,
      mimetype: 'image/jpeg',
      originalname: 'profile.jpg',
      size: buffer.length,
    };

    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'PROFILE_PHOTO',
        file: fakeFile,
        actor,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_CONTENT_MISMATCH',
    });

    expect(storageUploadMock).not.toHaveBeenCalled();

    expect(partnerDocumentService.createDocumentMetadata).not.toHaveBeenCalled();
  });

  it('rejects a fake PNG profile photo', async () => {
    const buffer = Buffer.from('not-a-real-png');

    const fakeFile: PartnerDocumentUploadFile = {
      buffer,
      mimetype: 'image/png',
      originalname: 'profile.png',
      size: buffer.length,
    };

    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'PROFILE_PHOTO',
        file: fakeFile,
        actor,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_CONTENT_MISMATCH',
    });

    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it('rejects a fake WebP profile photo', async () => {
    const buffer = Buffer.from('not-a-real-webp');

    const fakeFile: PartnerDocumentUploadFile = {
      buffer,
      mimetype: 'image/webp',
      originalname: 'profile.webp',
      size: buffer.length,
    };

    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'PROFILE_PHOTO',
        file: fakeFile,
        actor,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_CONTENT_MISMATCH',
    });

    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it('rejects a fake PDF document', async () => {
    const buffer = Buffer.from('not-a-real-pdf');

    const fakeFile: PartnerDocumentUploadFile = {
      buffer,
      mimetype: 'application/pdf',
      originalname: 'aadhaar.pdf',
      size: buffer.length,
    };

    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'AADHAAR',
        file: fakeFile,
        actor,
      }),
    ).rejects.toMatchObject({
      code: 'FILE_CONTENT_MISMATCH',
    });

    expect(storageUploadMock).not.toHaveBeenCalled();

    expect(partnerDocumentService.createDocumentMetadata).not.toHaveBeenCalled();
  });

  it('uses authenticated storage for sensitive partner documents', async () => {
    vi.mocked(partnerDocumentService.createDocumentMetadata).mockResolvedValue(
      createSafeDocument(),
    );

    await service.uploadDocument({
      partnerId,
      documentType: 'PAN',
      file,
      actor,
    });

    expect(storageUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'raw',
        accessMode: 'authenticated',
      }),
    );
  });

  it('passes vehicle id for vehicle documents', async () => {
    const vehicleId = '850e8400-e29b-41d4-a716-446655440000';

    vi.mocked(partnerDocumentService.createDocumentMetadata).mockResolvedValue(
      createSafeDocument({
        vehicleId,
        documentType: 'VEHICLE_RC',
      }),
    );

    await service.uploadDocument({
      partnerId,
      documentType: 'VEHICLE_RC',
      vehicleId,
      file,
      actor,
    });

    expect(partnerDocumentService.createDocumentMetadata).toHaveBeenCalledWith(
      partnerId,
      expect.objectContaining({
        vehicleId,
        documentType: 'VEHICLE_RC',
      }),
      actor,
    );
  });

  it('deletes uploaded storage when database persistence fails', async () => {
    const databaseError = new Error('Database insert failed');

    vi.mocked(partnerDocumentService.createDocumentMetadata).mockRejectedValue(databaseError);

    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'AADHAAR',
        file,
        actor,
      }),
    ).rejects.toBe(databaseError);

    expect(storageDeleteMock).toHaveBeenCalledTimes(1);

    expect(storageDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: expect.any(String),
        resourceType: 'raw',
        accessMode: 'authenticated',
      }),
    );
  });

  it('returns a short-lived access URL for authorized admin access', async () => {
    const document = createDocument();
    vi.mocked(partnerDocumentService.getDocument).mockResolvedValue(document);

    const url = await service.getDocumentAccessUrl(document, adminActor);

    expect(url).toBe('https://secure.example.com/document');

    expect(storageAccessUrlMock).toHaveBeenCalledWith({
      storageKey: 'infurnus/partners/test/aadhaar',
      resourceType: 'raw',
      accessMode: 'authenticated',
      options: {
        expiresIn: 300,
      },
    });
  });

  it('rejects sensitive document access for unrelated users', async () => {
    const document = createDocument();
    vi.mocked(partnerDocumentService.getDocument).mockRejectedValue(
      Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', statusCode: 403 }),
    );

    await expect(service.getDocumentAccessUrl(document, actor)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });

    expect(storageAccessUrlMock).not.toHaveBeenCalled();
  });

  it('rejects access when storage metadata is missing', async () => {
    const document = createDocument({
      metadata: null,
    });

    await expect(service.getDocumentAccessUrl(document, adminActor)).rejects.toMatchObject({
      code: 'DOCUMENT_STORAGE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('deletes document storage safely when storage metadata exists', async () => {
    const document = createDocument();

    await service.deleteDocumentStorage(document);

    expect(storageDeleteMock).toHaveBeenCalledWith({
      storageKey: 'infurnus/partners/test/aadhaar',
      resourceType: 'raw',
      accessMode: 'authenticated',
    });
  });

  it('does nothing when deleting a document without storage metadata', async () => {
    const document = createDocument({
      metadata: null,
    });

    await service.deleteDocumentStorage(document);

    expect(storageDeleteMock).not.toHaveBeenCalled();
  });
  it('authorizes partner ownership before any external upload', async () => {
    vi.mocked(partnerDocumentService.assertAccess).mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
    );
    await expect(
      service.uploadDocument({ partnerId, documentType: 'AADHAAR', file, actor }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(storageUploadMock).not.toHaveBeenCalled();
  });
  it('supports camera front/back pages and preserves source/number metadata', async () => {
    vi.mocked(partnerDocumentService.createDocumentMetadata).mockResolvedValue(
      createSafeDocument(),
    );
    await service.uploadDocument({
      partnerId,
      documentType: 'AADHAAR',
      file: createJpegFile(),
      files: [createJpegFile(), createJpegFile()],
      documentMetadata: { uploadSource: 'CAMERA', documentNumber: 'identity' },
      actor,
    });
    expect(storageUploadMock).toHaveBeenCalledTimes(2);
    expect(partnerDocumentService.createDocumentMetadata).toHaveBeenCalledWith(
      partnerId,
      expect.objectContaining({
        metadata: expect.objectContaining({
          uploadSource: 'CAMERA',
          documentNumber: 'identity',
          pages: [
            expect.objectContaining({ side: 'FRONT' }),
            expect.objectContaining({ side: 'BACK' }),
          ],
        }),
      }),
      actor,
    );
  });
  it('validates all pages before upload and rejects oversized or excessive bundles', async () => {
    const invalid = { ...createJpegFile(), buffer: Buffer.from('invalid'), size: 7 };
    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'AADHAAR',
        file: createJpegFile(),
        files: [createJpegFile(), invalid],
        actor,
      }),
    ).rejects.toMatchObject({ code: 'FILE_CONTENT_MISMATCH' });
    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'AADHAAR',
        file: createJpegFile(),
        files: Array.from({ length: 6 }, () => createJpegFile()),
        actor,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.uploadDocument({
        partnerId,
        documentType: 'AADHAAR',
        file: { ...file, size: 50 * 1024 * 1024 },
        actor,
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(storageUploadMock).not.toHaveBeenCalled();
  });
  it('renews non-photo documents with optimistic version and resets verification', async () => {
    const current = createDocument({ documentType: 'PAN', version: 2, status: 'VERIFIED' });
    vi.mocked(partnerDocumentService.getDocument).mockResolvedValue(current);
    vi.mocked(partnerDocumentService.updateDocumentMetadata).mockResolvedValue(
      createSafeDocument({ documentType: 'PAN', version: 3, status: 'PENDING' }),
    );
    await service.replaceDocument({
      partnerId,
      documentId: current.id,
      file,
      actor,
      documentMetadata: { expiresAt: '2099-01-01', uploadSource: 'CAMERA' },
    });
    expect(partnerDocumentService.updateDocumentMetadata).toHaveBeenCalledWith(
      partnerId,
      current.id,
      expect.objectContaining({ expiresAt: '2099-01-01' }),
      actor,
      2,
    );
  });
  it('replacement stores the new complete page bundle rather than stale review pages', async () => {
    const current = createDocument({
      documentType: 'PAN',
      version: 2,
      status: 'REJECTED',
      metadata: { pages: [{ storageKey: 'old-page' }] },
    });
    vi.mocked(partnerDocumentService.getDocument).mockResolvedValue(current);
    vi.mocked(partnerDocumentService.updateDocumentMetadata).mockResolvedValue(
      createSafeDocument(),
    );
    await service.replaceDocument({
      partnerId,
      documentId: current.id,
      file,
      files: [file, file],
      actor,
    });
    const update = vi.mocked(partnerDocumentService.updateDocumentMetadata).mock.calls[0]![2];
    expect(update.metadata?.pages).toHaveLength(2);
    expect(update.metadata?.pages).not.toEqual(current.metadata?.pages);
    expect(storageUploadMock).toHaveBeenCalledTimes(2);
  });
  it('failed replacement cleans up all newly uploaded pages', async () => {
    vi.mocked(partnerDocumentService.getDocument).mockResolvedValue(
      createDocument({ documentType: 'PAN' }),
    );
    vi.mocked(partnerDocumentService.updateDocumentMetadata).mockRejectedValue(
      new Error('Version conflict'),
    );
    await expect(
      service.replaceDocument({
        partnerId,
        documentId: createDocument().id,
        file,
        files: [file, file],
        actor,
      }),
    ).rejects.toThrow('Version conflict');
    expect(storageDeleteMock).toHaveBeenCalledTimes(2);
  });
  it('allows an authorized owner access and rechecks the current storage version', async () => {
    const document = createDocument();
    vi.mocked(partnerDocumentService.getDocument).mockResolvedValue(document);
    expect(await service.getDocumentAccessUrl(document, actor)).toBe(
      'https://secure.example.com/document',
    );
    vi.mocked(partnerDocumentService.getDocument).mockResolvedValue(
      createDocument({
        metadata: { storage: { ...document.metadata!.storage!, storageKey: 'new-key' } },
      }),
    );
    await expect(service.getDocumentAccessUrl(document, actor)).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
