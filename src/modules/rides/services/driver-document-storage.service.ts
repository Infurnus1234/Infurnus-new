import { AppError } from '../../../common/errors/app-error.js';
import { randomUUID } from 'node:crypto';

import {
  storageService,
  type StorageAccessMode,
  type StorageResourceType,
  type StorageFile,
} from '../../../infrastructure/storage/index.js';

import type {
  DriverDocument,
  DriverDocumentRepository,
  DriverDocumentType,
  CreateDriverDocumentInput,
} from '../repositories/driver-document.repository.js';

export interface UploadDriverDocumentInput {
  driverProfileId: string;
  documentType: DriverDocumentType;
  file: StorageFile;
  uploadedBy: string;
  uploadSource?: 'CAMERA' | 'GALLERY' | 'FILE' | undefined;
  documentMetadata?: Record<string, unknown> | undefined;
}

export interface DriverDocumentStorageServiceDependencies {
  repository: DriverDocumentRepository;
}

const DOCUMENT_CONFIG: Record<
  DriverDocumentType,
  {
    folderName: string;
    resourceType: StorageResourceType;
    accessMode: StorageAccessMode;
    allowedMimeTypes: readonly string[];
    maxFileSize: number;
  }
> = {
  profile_photo: {
    folderName: 'profile-photo',
    resourceType: 'image',
    accessMode: 'authenticated',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxFileSize: 10 * 1024 * 1024,
  },
  driver_license: {
    folderName: 'driver-license',
    resourceType: 'auto',
    accessMode: 'authenticated',
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    maxFileSize: 15 * 1024 * 1024,
  },
  vehicle_rc: {
    folderName: 'vehicle-rc',
    resourceType: 'auto',
    accessMode: 'authenticated',
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    maxFileSize: 15 * 1024 * 1024,
  },
  identity: {
    folderName: 'identity',
    resourceType: 'auto',
    accessMode: 'authenticated',
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    maxFileSize: 15 * 1024 * 1024,
  },
  pan: {
    folderName: 'pan',
    resourceType: 'auto',
    accessMode: 'authenticated',
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    maxFileSize: 15 * 1024 * 1024,
  },
  other: {
    folderName: 'other',
    resourceType: 'auto',
    accessMode: 'authenticated',
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    maxFileSize: 15 * 1024 * 1024,
  },
};

export class DriverDocumentStorageService {
  constructor(private readonly dependencies: DriverDocumentStorageServiceDependencies) {}

  async upload(input: UploadDriverDocumentInput): Promise<DriverDocument> {
    if (input.documentType !== 'other' && input.documentMetadata?.documentCode)
      throw new AppError(
        'INVALID_DOCUMENT_TYPE',
        'Custom document codes require the other document type',
        400,
      );
    const config = DOCUMENT_CONFIG[input.documentType];

    this.validateFile(input.file, config.allowedMimeTypes, config.maxFileSize);

    const existing = await this.dependencies.repository.findByDriverAndType(
      input.driverProfileId,
      input.documentType,
    );

    const folder = this.buildStorageFolder(input.driverProfileId, config.folderName);

    const storageKey = this.buildStorageKey(input.documentType, input.file.originalFileName);

    const uploaded = await storageService.upload({
      file: input.file,
      folder,
      resourceType: config.resourceType,
      accessMode: config.accessMode,
      storageKey,
    });

    try {
      if (this.dependencies.repository.saveBundle) {
        const saved = await this.dependencies.repository.saveBundle(
          {
            driverProfileId: input.driverProfileId,
            documentType: input.documentType,
            ...uploaded,
            uploadedBy: input.uploadedBy,
            uploadSource: input.uploadSource,
            documentMetadata: input.documentMetadata,
          },
          [],
        );
        if (saved.previous) await this.cleanupUploadedFile(saved.previous);
        return saved.document;
      }
      if (existing) {
        return await this.replaceDatabaseDocument(
          existing,
          uploaded,
          input.uploadedBy,
          input.uploadSource,
          input.documentMetadata,
        );
      }

      const documentInput: CreateDriverDocumentInput = {
        driverProfileId: input.driverProfileId,
        documentType: input.documentType,
        storageProvider: uploaded.storageProvider,
        storageKey: uploaded.storageKey,
        resourceType: uploaded.resourceType,
        accessMode: uploaded.accessMode,
        mimeType: uploaded.mimeType,
        fileSize: uploaded.fileSize,
        uploadedBy: input.uploadedBy,
        uploadSource: input.uploadSource,
        documentMetadata: input.documentMetadata,
      };

      return await this.dependencies.repository.create(documentInput);
    } catch (error) {
      await this.cleanupUploadedFile(uploaded);
      throw error;
    }
  }

  async uploadPages(
    input: Omit<UploadDriverDocumentInput, 'file'> & { files: StorageFile[] },
  ): Promise<DriverDocument> {
    if (!this.dependencies.repository.saveBundle)
      throw new Error('Document bundle storage is unavailable');
    if (input.documentType === 'profile_photo' || input.files.length < 1 || input.files.length > 5)
      throw new AppError(
        'INVALID_DOCUMENT_BUNDLE',
        'Document bundles require one to five pages',
        400,
      );
    if (input.documentType !== 'other' && input.documentMetadata?.documentCode)
      throw new AppError(
        'INVALID_DOCUMENT_TYPE',
        'Custom document codes require the other document type',
        400,
      );
    const config = DOCUMENT_CONFIG[input.documentType];
    for (const file of input.files)
      this.validateFile(file, config.allowedMimeTypes, config.maxFileSize);
    if (input.files.reduce((total, file) => total + file.fileSize, 0) > 30 * 1024 * 1024)
      throw new AppError('DOCUMENT_TOO_LARGE', 'Document bundle exceeds 30 MB', 413);
    const uploaded = [];
    try {
      for (const file of input.files)
        uploaded.push(
          await storageService.upload({
            file,
            folder: this.buildStorageFolder(input.driverProfileId, config.folderName),
            resourceType: config.resourceType,
            accessMode: 'authenticated',
            storageKey: this.buildStorageKey(input.documentType, file.originalFileName),
          }),
        );
      const first = uploaded[0]!;
      const saved = await this.dependencies.repository.saveBundle(
        {
          driverProfileId: input.driverProfileId,
          documentType: input.documentType,
          ...first,
          uploadedBy: input.uploadedBy,
          uploadSource: input.uploadSource,
          documentMetadata: input.documentMetadata,
        },
        uploaded.map((page, index) => ({
          ...page,
          side:
            index === 0 ? ('FRONT' as const) : index === 1 ? ('BACK' as const) : ('PAGE' as const),
        })),
      );
      if (saved.previous) await this.cleanupUploadedFile(saved.previous);
      return saved.document;
    } catch (error) {
      for (const file of uploaded) await this.cleanupUploadedFile(file);
      throw error;
    }
  }

  async getDocument(driverProfileId: string, documentId: string): Promise<DriverDocument | null> {
    const document = await this.dependencies.repository.findById(documentId);

    if (!document || document.driverProfileId !== driverProfileId) {
      return null;
    }

    return document;
  }

  async listDocuments(driverProfileId: string): Promise<DriverDocument[]> {
    return this.dependencies.repository.listByDriver(driverProfileId);
  }
  async getPageAccessUrls(driverProfileId: string, documentId: string) {
    if (!(await this.getDocument(driverProfileId, documentId))) return null;
    const pages =
      (await this.dependencies.repository.currentPages?.(driverProfileId, documentId)) ?? [];
    return Promise.all(
      pages.map(async (page) => ({
        side: page.side,
        accessUrl: await storageService.getAccessUrl({
          storageKey: page.storageKey,
          resourceType: page.resourceType,
          accessMode: 'authenticated',
          options: { expiresIn: 300 },
        }),
      })),
    );
  }

  async getAccessUrl(
    driverProfileId: string,
    documentId: string,
    expiresIn = 300,
  ): Promise<string | null> {
    const document = await this.getDocument(driverProfileId, documentId);

    if (!document) {
      return null;
    }

    return storageService.getAccessUrl({
      storageKey: document.storageKey,
      resourceType: document.resourceType,
      accessMode: document.accessMode,
      options: {
        expiresIn,
      },
    });
  }

  async getProfilePhotoAccessUrl(driverProfileId: string): Promise<string | null> {
    const document = await this.dependencies.repository.findByDriverAndType(
      driverProfileId,
      'profile_photo',
    );

    if (!document) {
      return null;
    }

    return storageService.getAccessUrl({
      storageKey: document.storageKey,
      resourceType: document.resourceType,
      accessMode: document.accessMode,
    });
  }

  async delete(driverProfileId: string, documentId: string): Promise<boolean> {
    const document = await this.getDocument(driverProfileId, documentId);

    if (!document) {
      return false;
    }

    const deleted = await this.dependencies.repository.delete(document.id);

    if (!deleted) {
      return false;
    }

    try {
      await storageService.delete({
        storageKey: document.storageKey,
        resourceType: document.resourceType,
        accessMode: document.accessMode,
      });
    } catch {
      // Database state remains authoritative.
      // Storage cleanup can be retried separately.
    }

    return true;
  }

  private async replaceDatabaseDocument(
    existing: DriverDocument,
    uploaded: {
      storageProvider: string;
      storageKey: string;
      resourceType: StorageResourceType;
      accessMode: StorageAccessMode;
      mimeType: string;
      fileSize: number;
    },
    uploadedBy: string,
    uploadSource?: 'CAMERA' | 'GALLERY' | 'FILE',
    documentMetadata?: Record<string, unknown>,
  ): Promise<DriverDocument> {
    const replacement = await this.dependencies.repository.replace(existing.id, {
      storageProvider: uploaded.storageProvider,
      storageKey: uploaded.storageKey,
      resourceType: uploaded.resourceType,
      accessMode: uploaded.accessMode,
      mimeType: uploaded.mimeType,
      fileSize: uploaded.fileSize,
      uploadedBy,
      uploadSource,
      documentMetadata,
    });

    if (!replacement) {
      throw new Error('Driver document replacement returned no row');
    }

    try {
      await storageService.delete({
        storageKey: existing.storageKey,
        resourceType: existing.resourceType,
        accessMode: existing.accessMode,
      });
    } catch {
      // New document is already persisted and valid.
      // Old storage cleanup can be retried separately.
    }

    return replacement;
  }

  private validateFile(
    file: StorageFile,
    allowedMimeTypes: readonly string[],
    maxFileSize: number,
  ): void {
    if (!file.buffer || file.buffer.length === 0) {
      throw new AppError('INVALID_DOCUMENT_UPLOAD', 'Driver document file is empty', 400);
    }

    if (!file.mimeType) {
      throw new AppError('INVALID_DOCUMENT_UPLOAD', 'Driver document MIME type is required', 400);
    }

    if (!allowedMimeTypes.includes(file.mimeType)) {
      throw new AppError(
        'INVALID_DOCUMENT_UPLOAD',
        `Unsupported driver document MIME type: ${file.mimeType}`,
        400,
      );
    }

    if (file.fileSize <= 0) {
      throw new AppError(
        'INVALID_DOCUMENT_UPLOAD',
        'Driver document file size must be greater than zero',
        400,
      );
    }

    if (file.fileSize > maxFileSize) {
      throw new AppError(
        'DOCUMENT_TOO_LARGE',
        `Driver document exceeds the maximum allowed size of ${maxFileSize} bytes`,
        413,
      );
    }

    if (!Number.isInteger(file.fileSize) || file.fileSize !== file.buffer.length) {
      throw new AppError(
        'INVALID_DOCUMENT_UPLOAD',
        'Driver document file size does not match its content',
        400,
      );
    }
    const extensions: Record<string, readonly string[]> = {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'application/pdf': ['.pdf'],
    };
    if (!extensions[file.mimeType]?.includes(this.extractExtension(file.originalFileName))) {
      throw new AppError(
        'INVALID_DOCUMENT_UPLOAD',
        'Driver document extension does not match its MIME type',
        400,
      );
    }

    this.validateFileContent(file.buffer, file.mimeType);
  }

  private validateFileContent(buffer: Buffer, mimeType: string): void {
    switch (mimeType) {
      case 'image/jpeg':
        if (!this.isJpeg(buffer)) {
          throw new AppError(
            'INVALID_DOCUMENT_UPLOAD',
            'Driver document file content does not match image/jpeg',
            400,
          );
        }
        break;

      case 'image/png':
        if (!this.isPng(buffer)) {
          throw new AppError(
            'INVALID_DOCUMENT_UPLOAD',
            'Driver document file content does not match image/png',
            400,
          );
        }
        break;

      case 'image/webp':
        if (!this.isWebp(buffer)) {
          throw new AppError(
            'INVALID_DOCUMENT_UPLOAD',
            'Driver document file content does not match image/webp',
            400,
          );
        }
        break;

      case 'application/pdf':
        if (!this.isPdf(buffer)) {
          throw new AppError(
            'INVALID_DOCUMENT_UPLOAD',
            'Driver document file content does not match application/pdf',
            400,
          );
        }
        break;

      default:
        throw new AppError(
          'INVALID_DOCUMENT_UPLOAD',
          `Unsupported driver document MIME type: ${mimeType}`,
          400,
        );
    }
  }

  private isJpeg(buffer: Buffer): boolean {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  private isPng(buffer: Buffer): boolean {
    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    return (
      buffer.length >= PNG_SIGNATURE.length &&
      buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    );
  }

  private isWebp(buffer: Buffer): boolean {
    return (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }

  private isPdf(buffer: Buffer): boolean {
    return buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-';
  }

  private buildStorageFolder(driverProfileId: string, documentFolder: string): string {
    return `infurnus/drivers/${driverProfileId}/documents/${documentFolder}`;
  }

  private buildStorageKey(documentType: DriverDocumentType, originalFileName: string): string {
    const extension = this.extractExtension(originalFileName);

    return `${documentType}-${randomUUID()}${extension}`;
  }

  private extractExtension(originalFileName: string): string {
    const lastDot = originalFileName.lastIndexOf('.');

    if (lastDot === -1) {
      return '';
    }

    const extension = originalFileName.slice(lastDot).toLowerCase();

    if (!/^\.[a-z0-9]{1,10}$/.test(extension)) {
      return '';
    }

    return extension;
  }

  private async cleanupUploadedFile(uploaded: {
    storageKey: string;
    resourceType: StorageResourceType;
    accessMode: StorageAccessMode;
  }): Promise<void> {
    try {
      await storageService.delete({
        storageKey: uploaded.storageKey,
        resourceType: uploaded.resourceType,
        accessMode: uploaded.accessMode,
      });
    } catch {
      // Best-effort cleanup.
    }
  }
}
