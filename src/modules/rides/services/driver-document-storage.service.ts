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
    accessMode: 'public',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxFileSize: 10 * 1024 * 1024,
  },
  driver_license: {
    folderName: 'driver-license',
    resourceType: 'auto',
    accessMode: 'authenticated',
    allowedMimeTypes: ['application/pdf'],
    maxFileSize: 15 * 1024 * 1024,
  },
  vehicle_rc: {
    folderName: 'vehicle-rc',
    resourceType: 'auto',
    accessMode: 'authenticated',
    allowedMimeTypes: ['application/pdf'],
    maxFileSize: 15 * 1024 * 1024,
  },
};

export class DriverDocumentStorageService {
  constructor(private readonly dependencies: DriverDocumentStorageServiceDependencies) {}

  async upload(input: UploadDriverDocumentInput): Promise<DriverDocument> {
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
      if (existing) {
        return await this.replaceDatabaseDocument(existing, uploaded, input.uploadedBy);
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
      };

      return await this.dependencies.repository.create(documentInput);
    } catch (error) {
      await this.cleanupUploadedFile(uploaded);
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
  ): Promise<DriverDocument> {
    const replacement = await this.dependencies.repository.replace(existing.id, {
      storageProvider: uploaded.storageProvider,
      storageKey: uploaded.storageKey,
      resourceType: uploaded.resourceType,
      accessMode: uploaded.accessMode,
      mimeType: uploaded.mimeType,
      fileSize: uploaded.fileSize,
      uploadedBy,
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
      throw new Error('Driver document file is empty');
    }

    if (!file.mimeType) {
      throw new Error('Driver document MIME type is required');
    }

    if (!allowedMimeTypes.includes(file.mimeType)) {
      throw new Error(`Unsupported driver document MIME type: ${file.mimeType}`);
    }

    if (file.fileSize <= 0) {
      throw new Error('Driver document file size must be greater than zero');
    }

    if (file.fileSize > maxFileSize) {
      throw new Error(`Driver document exceeds the maximum allowed size of ${maxFileSize} bytes`);
    }

    this.validateFileContent(file.buffer, file.mimeType);
  }

  private validateFileContent(buffer: Buffer, mimeType: string): void {
    switch (mimeType) {
      case 'image/jpeg':
        if (!this.isJpeg(buffer)) {
          throw new Error('Driver document file content does not match image/jpeg');
        }
        break;

      case 'image/png':
        if (!this.isPng(buffer)) {
          throw new Error('Driver document file content does not match image/png');
        }
        break;

      case 'image/webp':
        if (!this.isWebp(buffer)) {
          throw new Error('Driver document file content does not match image/webp');
        }
        break;

      case 'application/pdf':
        if (!this.isPdf(buffer)) {
          throw new Error('Driver document file content does not match application/pdf');
        }
        break;

      default:
        throw new Error(`Unsupported driver document MIME type: ${mimeType}`);
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
