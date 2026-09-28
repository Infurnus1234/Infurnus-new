import { randomUUID } from 'node:crypto';
import type { Buffer } from 'node:buffer';

import { AppError } from '../../../common/errors/app-error.js';
import {
  getStorageAccessMode,
  getStorageResourceType,
  validateStorageFile,
  type StorageDocumentCategory,
} from '../../../infrastructure/storage/validation.js';
import { storageService } from '../../../infrastructure/storage/index.js';
import type {
  StorageAccessMode,
  StorageFile,
  StorageResourceType,
} from '../../../infrastructure/storage/types.js';

import type { AuthenticatedUser } from '../../auth/types/auth.js';

import type { PartnerDocumentService } from './partner-document.service.js';

import type { PartnerDocument, PartnerDocumentType } from '../types/partner-document.js';

export interface PartnerDocumentUploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface UploadPartnerDocumentInput {
  partnerId: string;
  documentType: PartnerDocumentType;
  vehicleId?: string | null | undefined;
  file: PartnerDocumentUploadFile;
  actor: AuthenticatedUser;
}

export interface ReplacePartnerDocumentInput {
  partnerId: string;
  documentId: string;
  file: PartnerDocumentUploadFile;
  actor: AuthenticatedUser;
}

export interface DeletePartnerDocumentInput {
  partnerId: string;
  documentId: string;
  actor: AuthenticatedUser;
}

export type SafePartnerDocument = Omit<PartnerDocument, 'metadata'>;

export class PartnerDocumentStorageService {
  constructor(private readonly partnerDocumentService: PartnerDocumentService) {}

  async uploadDocument(input: UploadPartnerDocumentInput): Promise<SafePartnerDocument> {
    const category = getDocumentCategory(input.documentType);

    const accessMode = getStorageAccessMode(category);

    const resourceType = getStorageResourceType(category);

    const storageFile: StorageFile = {
      buffer: input.file.buffer,
      mimeType: input.file.mimetype,
      originalFileName: input.file.originalname,
      fileSize: input.file.size,
    };

    validateStorageFile(storageFile, {
      category,
      accessMode,
      resourceType,
    });

    const uploaded = await storageService.upload({
      file: storageFile,
      folder: buildStorageFolder(input.partnerId, input.documentType),
      resourceType,
      accessMode,
    });

    try {
      const document = await this.partnerDocumentService.createDocumentMetadata(
        input.partnerId,
        {
          vehicleId: input.vehicleId ?? null,
          documentType: input.documentType,
          status: 'PENDING',
          metadata: {
            storage: {
              storageProvider: uploaded.storageProvider,
              storageKey: uploaded.storageKey,
              resourceType: uploaded.resourceType,
              accessMode: uploaded.accessMode,
              mimeType: uploaded.mimeType,
              fileSize: uploaded.fileSize,
              originalFileName: storageFile.originalFileName,
            },
            uploadedBy: input.actor.userId,
          },
        },
        input.actor,
      );

      return document;
    } catch (error) {
      await cleanupUploadedFile(uploaded.storageKey, uploaded.resourceType, uploaded.accessMode);

      throw error;
    }
  }

  async replaceDocument(input: ReplacePartnerDocumentInput): Promise<SafePartnerDocument> {
    const existing = await this.partnerDocumentService.getDocument(
      input.partnerId,
      input.documentId,
      input.actor,
    );

    if (existing.documentType !== 'PROFILE_PHOTO') {
      throw new AppError(
        'INVALID_DOCUMENT_TYPE',
        'Only profile photos can be replaced through this operation',
        400,
      );
    }

    const category = getDocumentCategory(existing.documentType);

    const accessMode = getStorageAccessMode(category);

    const resourceType = getStorageResourceType(category);

    const storageFile: StorageFile = {
      buffer: input.file.buffer,
      mimeType: input.file.mimetype,
      originalFileName: input.file.originalname,
      fileSize: input.file.size,
    };

    validateStorageFile(storageFile, {
      category,
      accessMode,
      resourceType,
    });

    const folder = buildStorageFolder(input.partnerId, existing.documentType);

    const newStorageKey = buildUniqueStorageKey(folder);

    const uploaded = await storageService.upload({
      file: storageFile,
      folder,
      resourceType,
      accessMode,
      storageKey: newStorageKey,
    });

    const previousStorage = existing.metadata?.storage;

    try {
      const updated = await this.partnerDocumentService.updateDocumentMetadata(
        input.partnerId,
        input.documentId,
        {
          metadata: {
            ...(existing.metadata ?? {}),
            storage: {
              storageProvider: uploaded.storageProvider,
              storageKey: uploaded.storageKey,
              resourceType: uploaded.resourceType,
              accessMode: uploaded.accessMode,
              mimeType: uploaded.mimeType,
              fileSize: uploaded.fileSize,
              originalFileName: storageFile.originalFileName,
            },
            uploadedBy: input.actor.userId,
          },
        },
        input.actor,
      );

      if (previousStorage) {
        await cleanupUploadedFile(
          previousStorage.storageKey,
          previousStorage.resourceType,
          previousStorage.accessMode,
        );
      }

      return updated;
    } catch (error) {
      await cleanupUploadedFile(uploaded.storageKey, uploaded.resourceType, uploaded.accessMode);

      throw error;
    }
  }

  async getDocument(
    partnerId: string,
    documentId: string,
    actor: AuthenticatedUser,
  ): Promise<PartnerDocument> {
    return this.partnerDocumentService.getDocument(partnerId, documentId, actor);
  }

  async getDocumentAccessUrl(document: PartnerDocument, actor: AuthenticatedUser): Promise<string> {
    if (!document.metadata?.storage) {
      throw new AppError(
        'DOCUMENT_STORAGE_NOT_FOUND',
        'Document storage information is unavailable',
        404,
      );
    }

    const storage = document.metadata.storage;

    if (
      storage.accessMode === 'authenticated' &&
      actor.role !== 'admin' &&
      actor.role !== 'super_admin'
    ) {
      throw new AppError('FORBIDDEN', 'You do not have permission to access this document', 403);
    }

    return storageService.getAccessUrl({
      storageKey: storage.storageKey,
      resourceType: storage.resourceType,
      accessMode: storage.accessMode,
      options: {
        expiresIn: 300,
      },
    });
  }

  async deleteDocument(input: DeletePartnerDocumentInput): Promise<void> {
    const existing = await this.partnerDocumentService.getDocument(
      input.partnerId,
      input.documentId,
      input.actor,
    );

    const storage = existing.metadata?.storage;

    await this.partnerDocumentService.deleteDocument(
      input.partnerId,
      input.documentId,
      input.actor,
    );

    if (!storage) {
      return;
    }

    await cleanupUploadedFile(storage.storageKey, storage.resourceType, storage.accessMode);
  }

  async deleteDocumentStorage(document: PartnerDocument): Promise<void> {
    const storage = document.metadata?.storage;

    if (!storage) {
      return;
    }

    await storageService.delete({
      storageKey: storage.storageKey,
      resourceType: storage.resourceType,
      accessMode: storage.accessMode,
    });
  }
}

function getDocumentCategory(documentType: PartnerDocumentType): StorageDocumentCategory {
  switch (documentType) {
    case 'AADHAAR':
      return 'partner-aadhaar';

    case 'PAN':
      return 'partner-pan';

    case 'DRIVING_LICENCE':
      return 'driver-license';

    case 'PROFILE_PHOTO':
      return 'partner-profile-photo';

    case 'ADDRESS_PROOF':
      return 'partner-address-proof';

    case 'VEHICLE_RC':
      return 'vehicle-rc';

    case 'VEHICLE_INSURANCE':
      return 'vehicle-insurance';

    case 'VEHICLE_PERMIT':
      return 'vehicle-permit';

    case 'VEHICLE_FITNESS':
      return 'vehicle-fitness';

    case 'OTHER':
      return 'partner-document';
  }
}

function buildStorageFolder(partnerId: string, documentType: PartnerDocumentType): string {
  return ['infurnus', 'partners', partnerId, 'documents', documentType.toLowerCase()].join('/');
}

function buildUniqueStorageKey(folder: string): string {
  return `${folder}/${randomUUID()}`;
}

async function cleanupUploadedFile(
  storageKey: string,
  resourceType: StorageResourceType,
  accessMode: StorageAccessMode,
): Promise<void> {
  try {
    await storageService.delete({
      storageKey,
      resourceType,
      accessMode,
    });
  } catch {
    // Storage cleanup is best-effort.
    // The original database/business operation
    // must remain the primary result.
  }
}
