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
  files?: PartnerDocumentUploadFile[] | undefined;
  actor: AuthenticatedUser;
  documentMetadata?: Record<string, unknown> | undefined;
}

export interface ReplacePartnerDocumentInput {
  partnerId: string;
  documentId: string;
  file: PartnerDocumentUploadFile;
  files?: PartnerDocumentUploadFile[] | undefined;
  documentMetadata?: Record<string, unknown> | undefined;
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
    await this.partnerDocumentService.assertAccess(input.partnerId, input.actor);
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

    const uploads = await uploadPages(
      input.files ?? [input.file],
      category,
      buildStorageFolder(input.partnerId, input.documentType),
    );
    const uploaded = uploads[0]!;

    try {
      const document = await this.partnerDocumentService.createDocumentMetadata(
        input.partnerId,
        {
          vehicleId: input.vehicleId ?? null,
          documentType: input.documentType,
          status: 'PENDING',
          issuedAt: input.documentMetadata?.issuedAt as string | undefined,
          expiresAt: input.documentMetadata?.expiresAt as string | undefined,
          metadata: {
            ...input.documentMetadata,
            pages: uploads.map((page, index) => ({
              ...page,
              side: index === 0 ? 'FRONT' : index === 1 ? 'BACK' : 'PAGE',
            })),
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
      for (const page of uploads)
        await cleanupUploadedFile(page.storageKey, page.resourceType, page.accessMode);

      throw error;
    }
  }

  async replaceDocument(input: ReplacePartnerDocumentInput): Promise<SafePartnerDocument> {
    const existing = await this.partnerDocumentService.getDocument(
      input.partnerId,
      input.documentId,
      input.actor,
    );

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

    const uploads = await uploadPages(input.files ?? [input.file], category, folder);
    const uploaded = uploads[0]!;

    const previousStorage = existing.metadata?.storage;

    try {
      const updated = await this.partnerDocumentService.updateDocumentMetadata(
        input.partnerId,
        input.documentId,
        {
          issuedAt: input.documentMetadata?.issuedAt as string | undefined,
          expiresAt: input.documentMetadata?.expiresAt as string | undefined,
          metadata: {
            ...(existing.metadata ?? {}),
            ...input.documentMetadata,
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
        existing.version,
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

    const authorized = await this.partnerDocumentService.getDocument(
      document.partnerId,
      document.id,
      actor,
    );
    if (authorized.metadata?.storage?.storageKey !== storage.storageKey)
      throw new AppError('DOCUMENT_CHANGED', 'Document changed; request a new access URL', 409);

    return storageService.getAccessUrl({
      storageKey: storage.storageKey,
      resourceType: storage.resourceType,
      accessMode: storage.accessMode,
      options: {
        expiresIn: 300,
      },
    });
  }

  async getPageAccessUrls(partnerId: string, documentId: string, actor: AuthenticatedUser) {
    const document = await this.partnerDocumentService.getDocument(partnerId, documentId, actor);
    const pages = document.metadata?.pages;
    if (!Array.isArray(pages)) return [];
    if (pages.length > 5)
      throw new AppError('INVALID_DOCUMENT_BUNDLE', 'Invalid stored page count', 500);
    return Promise.all(
      pages.map(async (page, index) => ({
        side: index === 0 ? 'FRONT' : index === 1 ? 'BACK' : 'PAGE',
        accessUrl: await storageService.getAccessUrl({
          storageKey: page.storageKey,
          resourceType: page.resourceType,
          accessMode: 'authenticated',
          options: { expiresIn: 300 },
        }),
      })),
    );
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

    case 'VEHICLE_PUC':
      return 'partner-document';

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

async function uploadPages(
  files: PartnerDocumentUploadFile[],
  category: StorageDocumentCategory,
  folder: string,
) {
  if (
    files.length < 1 ||
    files.length > 5 ||
    (category === 'partner-profile-photo' && files.length !== 1)
  )
    throw new AppError('INVALID_DOCUMENT_BUNDLE', 'Invalid page count', 400);
  if (files.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024)
    throw new AppError('DOCUMENT_TOO_LARGE', 'Bundle exceeds 30 MB', 413);
  const resourceType = getStorageResourceType(category),
    accessMode = getStorageAccessMode(category);
  for (const file of files)
    validateStorageFile(
      {
        buffer: file.buffer,
        mimeType: file.mimetype,
        originalFileName: file.originalname,
        fileSize: file.size,
      },
      { category, resourceType, accessMode },
    );
  const uploaded: Awaited<ReturnType<typeof storageService.upload>>[] = [];
  try {
    for (const file of files)
      uploaded.push(
        await storageService.upload({
          file: {
            buffer: file.buffer,
            mimeType: file.mimetype,
            originalFileName: file.originalname,
            fileSize: file.size,
          },
          folder,
          resourceType,
          accessMode,
          storageKey: buildUniqueStorageKey(folder),
        }),
      );
    return uploaded;
  } catch (error) {
    for (const page of uploaded)
      await cleanupUploadedFile(page.storageKey, page.resourceType, page.accessMode);
    throw error;
  }
}
