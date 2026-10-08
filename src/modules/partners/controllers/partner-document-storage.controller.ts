import { driverDocumentMetadataSchema } from '../../rides/schemas/driver.schemas.js';
import type { NextFunction, Request, Response } from 'express';

import { partnerIdSchema } from '../schemas/partner.schemas.js';
import { partnerDocumentIdSchema } from '../schemas/partner-document.schemas.js';
import { partnerDocumentTypes } from '../types/partner-document.js';

import type {
  PartnerDocumentStorageService,
  PartnerDocumentUploadFile,
} from '../services/partner-document-storage.service.js';

type StorageUploadRequest = Request & {
  storageFiles?: Array<{
    buffer: Buffer;
    mimeType: string;
    originalFileName: string;
    fileSize: number;
    fieldName: string;
  }>;
  storageFile?: {
    buffer: Buffer;
    mimeType: string;
    originalFileName: string;
    fileSize: number;
    fieldName: string;
  };
};

export class PartnerDocumentStorageController {
  constructor(private readonly service: PartnerDocumentStorageService) {}

  upload = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { id: partnerId } = partnerIdSchema.parse(request.params);

      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      const storageRequest = request as StorageUploadRequest;

      const file = storageRequest.storageFile ?? storageRequest.storageFiles?.[0];

      if (!file) {
        throw new Error('A file is required');
      }

      const documentType = parseDocumentType(request.body?.documentType);

      const vehicleId = parseOptionalVehicleId(request.body?.vehicleId);

      const uploadFile: PartnerDocumentUploadFile = {
        buffer: file.buffer,
        mimetype: file.mimeType,
        originalname: file.originalFileName,
        size: file.fileSize,
      };

      const document = await this.service.uploadDocument({
        partnerId,
        documentType,
        vehicleId,
        file: uploadFile,
        files: storageRequest.storageFiles?.map((page) => ({
          buffer: page.buffer,
          mimetype: page.mimeType,
          originalname: page.originalFileName,
          size: page.fileSize,
        })),
        actor: request.auth,
        documentMetadata: driverDocumentMetadataSchema.parse({
          uploadSource: request.body?.uploadSource,
          documentCode: request.body?.documentCode,
          documentNumber: request.body?.documentNumber,
          issuingAuthority: request.body?.issuingAuthority,
          issuedAt: request.body?.issuedAt,
          expiresAt: request.body?.expiresAt,
          side: request.body?.side,
        }),
      });

      response.status(201).json({
        success: true,
        data: document,
        message: 'Partner document uploaded',
      });
    } catch (error) {
      next(error);
    }
  };

  replace = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { id: partnerId, documentId } = partnerDocumentIdSchema.parse(request.params);

      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      const storageRequest = request as StorageUploadRequest;

      const file = storageRequest.storageFile ?? storageRequest.storageFiles?.[0];

      if (!file) {
        throw new Error('A file is required');
      }

      const uploadFile: PartnerDocumentUploadFile = {
        buffer: file.buffer,
        mimetype: file.mimeType,
        originalname: file.originalFileName,
        size: file.fileSize,
      };

      const document = await this.service.replaceDocument({
        partnerId,
        documentId,
        file: uploadFile,
        files: storageRequest.storageFiles?.map((page) => ({
          buffer: page.buffer,
          mimetype: page.mimeType,
          originalname: page.originalFileName,
          size: page.fileSize,
        })),
        actor: request.auth,
        documentMetadata: driverDocumentMetadataSchema.parse({
          uploadSource: request.body?.uploadSource,
          documentCode: request.body?.documentCode,
          documentNumber: request.body?.documentNumber,
          issuingAuthority: request.body?.issuingAuthority,
          issuedAt: request.body?.issuedAt,
          expiresAt: request.body?.expiresAt,
          side: request.body?.side,
        }),
      });

      response.json({
        success: true,
        data: document,
        message: 'Partner document replaced',
      });
    } catch (error) {
      next(error);
    }
  };

  getPageAccessUrls = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id, documentId } = partnerDocumentIdSchema.parse(request.params);
      if (!request.auth) throw new Error('Authentication required');
      response.json({
        success: true,
        data: await this.service.getPageAccessUrls(id, documentId, request.auth),
      });
    } catch (error) {
      next(error);
    }
  };

  getAccessUrl = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id: partnerId, documentId } = partnerDocumentIdSchema.parse(request.params);

      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      /*
       * The storage service requires the complete
       * document metadata in order to generate the
       * correct Cloudinary access URL.
       *
       * The document must therefore belong to the
       * requested partner before generating the URL.
       */
      const document = await this.service.getDocument(partnerId, documentId, request.auth);

      const url = await this.service.getDocumentAccessUrl(document, request.auth);

      response.json({
        success: true,
        data: {
          url,
          expiresIn: 300,
        },
        message: 'Document access URL generated',
      });
    } catch (error) {
      next(error);
    }
  };

  delete = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { id: partnerId, documentId } = partnerDocumentIdSchema.parse(request.params);

      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      await this.service.deleteDocument({
        partnerId,
        documentId,
        actor: request.auth,
      });

      response.json({
        success: true,
        data: null,
        message: 'Partner document deleted',
      });
    } catch (error) {
      next(error);
    }
  };
}

function parseDocumentType(value: unknown): (typeof partnerDocumentTypes)[number] {
  if (
    typeof value !== 'string' ||
    !partnerDocumentTypes.includes(value as (typeof partnerDocumentTypes)[number])
  ) {
    throw new Error('Invalid documentType');
  }

  return value as (typeof partnerDocumentTypes)[number];
}

function parseOptionalVehicleId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('vehicleId must be a string');
  }

  return value;
}
