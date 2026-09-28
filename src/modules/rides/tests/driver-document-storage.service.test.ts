import { beforeEach, describe, expect, it, vi } from 'vitest';

import { storageService } from '../../../infrastructure/storage/index.js';

import {
  DriverDocumentStorageService,
  type UploadDriverDocumentInput,
} from '../services/driver-document-storage.service.js';

import type {
  DriverDocument,
  DriverDocumentRepository,
} from '../repositories/driver-document.repository.js';

vi.mock('../../../infrastructure/storage/index.js', () => ({
  storageService: {
    upload: vi.fn(),
    delete: vi.fn(),
    getAccessUrl: vi.fn(),
  },
}));

const driverProfileId = '11111111-1111-1111-1111-111111111111';

const uploadedBy = '22222222-2222-2222-2222-222222222222';

const documentId = '33333333-3333-3333-3333-333333333333';

const fileBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const file = {
  buffer: fileBuffer,
  mimeType: 'image/jpeg',
  originalFileName: 'profile.jpg',
  fileSize: fileBuffer.length,
};

function createDocument(overrides: Partial<DriverDocument> = {}): DriverDocument {
  return {
    id: documentId,
    driverProfileId,
    documentType: 'profile_photo',
    storageProvider: 'cloudinary',
    storageKey: `infurnus/drivers/${driverProfileId}/documents/profile-photo/profile_photo-test.jpg`,
    resourceType: 'image',
    accessMode: 'public',
    mimeType: 'image/jpeg',
    fileSize: file.fileSize,
    verificationStatus: 'pending',
    rejectionReason: null,
    uploadedBy,
    verifiedBy: null,
    verifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createRepositoryMock(): {
  repository: DriverDocumentRepository;
  findByDriverAndType: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  listByDriver: ReturnType<typeof vi.fn>;
  updateVerification: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  const findByDriverAndType = vi.fn();
  const create = vi.fn();
  const replace = vi.fn();
  const findById = vi.fn();
  const listByDriver = vi.fn();
  const updateVerification = vi.fn();
  const deleteDocument = vi.fn();

  const repository = {
    findByDriverAndType,
    create,
    replace,
    findById,
    listByDriver,
    updateVerification,
    delete: deleteDocument,
  } as unknown as DriverDocumentRepository;

  return {
    repository,
    findByDriverAndType,
    create,
    replace,
    findById,
    listByDriver,
    updateVerification,
    delete: deleteDocument,
  };
}

describe('DriverDocumentStorageService', () => {
  let service: DriverDocumentStorageService;
  let repository: ReturnType<typeof createRepositoryMock>;

  const mockStorageUpload = vi.mocked(storageService.upload);

  const mockStorageDelete = vi.mocked(storageService.delete);

  const mockStorageAccessUrl = vi.mocked(storageService.getAccessUrl);

  beforeEach(() => {
    vi.clearAllMocks();

    repository = createRepositoryMock();

    service = new DriverDocumentStorageService({
      repository: repository.repository,
    });

    mockStorageUpload.mockResolvedValue({
      storageProvider: 'cloudinary',
      storageKey: `infurnus/drivers/${driverProfileId}/documents/profile-photo/profile_photo-uploaded.jpg`,
      resourceType: 'image',
      accessMode: 'public',
      mimeType: 'image/jpeg',
      fileSize: file.fileSize,
    });

    mockStorageDelete.mockResolvedValue(undefined);

    mockStorageAccessUrl.mockResolvedValue(
      'https://res.cloudinary.com/example/image/upload/profile-photo.jpg',
    );
  });

  // ==========================================================
  // Upload
  // ==========================================================

  it('uploads a profile photo and creates document metadata', async () => {
    repository.findByDriverAndType.mockResolvedValue(null);

    const document = createDocument();

    repository.create.mockResolvedValue(document);

    const input: UploadDriverDocumentInput = {
      driverProfileId,
      documentType: 'profile_photo',
      file,
      uploadedBy,
    };

    const result = await service.upload(input);

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        folder: `infurnus/drivers/${driverProfileId}/documents/profile-photo`,
        resourceType: 'image',
        accessMode: 'public',
      }),
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        driverProfileId,
        documentType: 'profile_photo',
        storageProvider: 'cloudinary',
        resourceType: 'image',
        accessMode: 'public',
        mimeType: 'image/jpeg',
        fileSize: file.fileSize,
        uploadedBy,
      }),
    );

    expect(result).toEqual(document);
  });

  it('uses authenticated storage for driver license documents', async () => {
    const pdfFile = {
      buffer: Buffer.from('%PDF-fake-driver-license'),
      mimeType: 'application/pdf',
      originalFileName: 'driver-license.pdf',
      fileSize: Buffer.byteLength('%PDF-fake-driver-license'),
    };

    repository.findByDriverAndType.mockResolvedValue(null);

    repository.create.mockResolvedValue(
      createDocument({
        documentType: 'driver_license',
        resourceType: 'auto',
        accessMode: 'authenticated',
        mimeType: 'application/pdf',
        fileSize: pdfFile.fileSize,
      }),
    );

    await service.upload({
      driverProfileId,
      documentType: 'driver_license',
      file: pdfFile,
      uploadedBy,
    });

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        file: pdfFile,
        folder: `infurnus/drivers/${driverProfileId}/documents/driver-license`,
        resourceType: 'auto',
        accessMode: 'authenticated',
      }),
    );
  });

  it('uses authenticated storage for vehicle RC documents', async () => {
    const pdfFile = {
      buffer: Buffer.from('%PDF-fake-vehicle-rc'),
      mimeType: 'application/pdf',
      originalFileName: 'vehicle-rc.pdf',
      fileSize: Buffer.byteLength('%PDF-fake-vehicle-rc'),
    };

    repository.findByDriverAndType.mockResolvedValue(null);

    repository.create.mockResolvedValue(
      createDocument({
        documentType: 'vehicle_rc',
        resourceType: 'auto',
        accessMode: 'authenticated',
        mimeType: 'application/pdf',
        fileSize: pdfFile.fileSize,
      }),
    );

    await service.upload({
      driverProfileId,
      documentType: 'vehicle_rc',
      file: pdfFile,
      uploadedBy,
    });

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        file: pdfFile,
        folder: `infurnus/drivers/${driverProfileId}/documents/vehicle-rc`,
        resourceType: 'auto',
        accessMode: 'authenticated',
      }),
    );
  });

  // ==========================================================
  // Validation
  // ==========================================================

  it('rejects an unsupported profile photo MIME type', async () => {
    repository.findByDriverAndType.mockResolvedValue(null);

    await expect(
      service.upload({
        driverProfileId,
        documentType: 'profile_photo',
        file: {
          buffer: Buffer.from('fake-pdf'),
          mimeType: 'application/pdf',
          originalFileName: 'profile.pdf',
          fileSize: 8,
        },
        uploadedBy,
      }),
    ).rejects.toThrow('Unsupported driver document MIME type: application/pdf');

    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects a driver license that is not a PDF', async () => {
    await expect(
      service.upload({
        driverProfileId,
        documentType: 'driver_license',
        file: {
          buffer: Buffer.from('fake-image'),
          mimeType: 'image/jpeg',
          originalFileName: 'license.jpg',
          fileSize: 10,
        },
        uploadedBy,
      }),
    ).rejects.toThrow('Unsupported driver document MIME type: image/jpeg');

    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('rejects a JPEG MIME type when file content is not JPEG', async () => {
    await expect(
      service.upload({
        driverProfileId,
        documentType: 'profile_photo',
        file: {
          buffer: Buffer.from('not-a-real-jpeg'),
          mimeType: 'image/jpeg',
          originalFileName: 'profile.jpg',
          fileSize: Buffer.byteLength('not-a-real-jpeg'),
        },
        uploadedBy,
      }),
    ).rejects.toThrow('Driver document file content does not match image/jpeg');

    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects a PNG MIME type when file content is not PNG', async () => {
    await expect(
      service.upload({
        driverProfileId,
        documentType: 'profile_photo',
        file: {
          buffer: Buffer.from('not-a-real-png'),
          mimeType: 'image/png',
          originalFileName: 'profile.png',
          fileSize: Buffer.byteLength('not-a-real-png'),
        },
        uploadedBy,
      }),
    ).rejects.toThrow('Driver document file content does not match image/png');

    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects a WebP MIME type when file content is not WebP', async () => {
    await expect(
      service.upload({
        driverProfileId,
        documentType: 'profile_photo',
        file: {
          buffer: Buffer.from('not-a-real-webp'),
          mimeType: 'image/webp',
          originalFileName: 'profile.webp',
          fileSize: Buffer.byteLength('not-a-real-webp'),
        },
        uploadedBy,
      }),
    ).rejects.toThrow('Driver document file content does not match image/webp');

    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects a PDF MIME type when file content is not PDF', async () => {
    await expect(
      service.upload({
        driverProfileId,
        documentType: 'driver_license',
        file: {
          buffer: Buffer.from('not-a-real-pdf'),
          mimeType: 'application/pdf',
          originalFileName: 'license.pdf',
          fileSize: Buffer.byteLength('not-a-real-pdf'),
        },
        uploadedBy,
      }),
    ).rejects.toThrow('Driver document file content does not match application/pdf');

    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('accepts a valid PNG signature', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const pngFile = {
      buffer: pngBuffer,
      mimeType: 'image/png',
      originalFileName: 'profile.png',
      fileSize: pngBuffer.length,
    };

    repository.findByDriverAndType.mockResolvedValue(null);

    repository.create.mockResolvedValue(
      createDocument({
        mimeType: 'image/png',
        fileSize: pngFile.fileSize,
      }),
    );

    await service.upload({
      driverProfileId,
      documentType: 'profile_photo',
      file: pngFile,
      uploadedBy,
    });

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        file: pngFile,
      }),
    );
  });

  it('accepts a valid WebP signature', async () => {
    const webpBuffer = Buffer.from('524946461000000057454250', 'hex');

    const webpFile = {
      buffer: webpBuffer,
      mimeType: 'image/webp',
      originalFileName: 'profile.webp',
      fileSize: webpBuffer.length,
    };

    repository.findByDriverAndType.mockResolvedValue(null);

    repository.create.mockResolvedValue(
      createDocument({
        mimeType: 'image/webp',
        fileSize: webpFile.fileSize,
      }),
    );

    await service.upload({
      driverProfileId,
      documentType: 'profile_photo',
      file: webpFile,
      uploadedBy,
    });

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        file: webpFile,
      }),
    );
  });

  it('rejects an empty file', async () => {
    await expect(
      service.upload({
        driverProfileId,
        documentType: 'profile_photo',
        file: {
          buffer: Buffer.alloc(0),
          mimeType: 'image/jpeg',
          originalFileName: 'profile.jpg',
          fileSize: 0,
        },
        uploadedBy,
      }),
    ).rejects.toThrow('Driver document file is empty');

    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('rejects a file larger than the configured maximum size', async () => {
    const oversizedFile = {
      buffer: fileBuffer,
      mimeType: 'image/jpeg',
      originalFileName: 'profile.jpg',
      fileSize: 10 * 1024 * 1024 + 1,
    };

    await expect(
      service.upload({
        driverProfileId,
        documentType: 'profile_photo',
        file: oversizedFile,
        uploadedBy,
      }),
    ).rejects.toThrow('Driver document exceeds the maximum allowed size of 10485760 bytes');

    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  // ==========================================================
  // Replacement
  // ==========================================================

  it('replaces an existing document of the same type', async () => {
    const existing = createDocument({
      storageKey: `infurnus/drivers/${driverProfileId}/documents/profile-photo/old-profile.jpg`,
    });

    const replacement = createDocument({
      storageKey: `infurnus/drivers/${driverProfileId}/documents/profile-photo/profile_photo-uploaded.jpg`,
    });

    repository.findByDriverAndType.mockResolvedValue(existing);

    repository.replace.mockResolvedValue(replacement);

    const result = await service.upload({
      driverProfileId,
      documentType: 'profile_photo',
      file,
      uploadedBy,
    });

    expect(repository.create).not.toHaveBeenCalled();

    expect(repository.replace).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({
        storageProvider: 'cloudinary',
        storageKey: `infurnus/drivers/${driverProfileId}/documents/profile-photo/profile_photo-uploaded.jpg`,
        resourceType: 'image',
        accessMode: 'public',
        mimeType: 'image/jpeg',
        fileSize: file.fileSize,
        uploadedBy,
      }),
    );

    expect(mockStorageDelete).toHaveBeenCalledWith({
      storageKey: existing.storageKey,
      resourceType: existing.resourceType,
      accessMode: existing.accessMode,
    });

    expect(result).toEqual(replacement);
  });

  // ==========================================================
  // Cleanup
  // ==========================================================

  it('deletes uploaded storage when database creation fails', async () => {
    repository.findByDriverAndType.mockResolvedValue(null);

    repository.create.mockRejectedValue(new Error('database insert failed'));

    await expect(
      service.upload({
        driverProfileId,
        documentType: 'profile_photo',
        file,
        uploadedBy,
      }),
    ).rejects.toThrow('database insert failed');

    expect(mockStorageUpload).toHaveBeenCalled();

    expect(mockStorageDelete).toHaveBeenCalledWith({
      storageKey: `infurnus/drivers/${driverProfileId}/documents/profile-photo/profile_photo-uploaded.jpg`,
      resourceType: 'image',
      accessMode: 'public',
    });
  });

  // ==========================================================
  // Ownership
  // ==========================================================

  it('returns null when requested document does not belong to the driver', async () => {
    repository.findById.mockResolvedValue(
      createDocument({
        driverProfileId: '44444444-4444-4444-4444-444444444444',
      }),
    );

    const result = await service.getDocument(driverProfileId, documentId);

    expect(result).toBeNull();
  });

  // ==========================================================
  // Access URL
  // ==========================================================

  it('generates an access URL only for the owning driver', async () => {
    repository.findById.mockResolvedValue(createDocument());

    const result = await service.getAccessUrl(driverProfileId, documentId);

    expect(result).toBe('https://res.cloudinary.com/example/image/upload/profile-photo.jpg');

    expect(mockStorageAccessUrl).toHaveBeenCalledWith({
      storageKey: `infurnus/drivers/${driverProfileId}/documents/profile-photo/profile_photo-test.jpg`,
      resourceType: 'image',
      accessMode: 'public',
      options: {
        expiresIn: 300,
      },
    });
  });

  it('returns null for access URL when document belongs to another driver', async () => {
    repository.findById.mockResolvedValue(
      createDocument({
        driverProfileId: '44444444-4444-4444-4444-444444444444',
      }),
    );

    const result = await service.getAccessUrl(driverProfileId, documentId);

    expect(result).toBeNull();

    expect(mockStorageAccessUrl).not.toHaveBeenCalled();
  });

  // ==========================================================
  // Delete
  // ==========================================================

  it('deletes document metadata and storage for the owning driver', async () => {
    const document = createDocument();

    repository.findById.mockResolvedValue(document);

    repository.delete.mockResolvedValue(true);

    const result = await service.delete(driverProfileId, documentId);

    expect(result).toBe(true);

    expect(repository.delete).toHaveBeenCalledWith(documentId);

    expect(mockStorageDelete).toHaveBeenCalledWith({
      storageKey: document.storageKey,
      resourceType: document.resourceType,
      accessMode: document.accessMode,
    });
  });

  it('does not delete another driver document', async () => {
    repository.findById.mockResolvedValue(
      createDocument({
        driverProfileId: '44444444-4444-4444-4444-444444444444',
      }),
    );

    const result = await service.delete(driverProfileId, documentId);

    expect(result).toBe(false);

    expect(repository.delete).not.toHaveBeenCalled();

    expect(mockStorageDelete).not.toHaveBeenCalled();
  });

  it('keeps database deletion successful when storage cleanup fails', async () => {
    const document = createDocument();

    repository.findById.mockResolvedValue(document);

    repository.delete.mockResolvedValue(true);

    mockStorageDelete.mockRejectedValue(new Error('Cloudinary delete failed'));

    const result = await service.delete(driverProfileId, documentId);

    expect(result).toBe(true);

    expect(repository.delete).toHaveBeenCalledWith(documentId);

    expect(mockStorageDelete).toHaveBeenCalled();
  });
});
