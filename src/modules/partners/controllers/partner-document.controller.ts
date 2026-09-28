import type { NextFunction, Request, Response } from 'express';

import { partnerIdSchema } from '../schemas/partner.schemas.js';

import {
  createPartnerDocumentSchema,
  partnerDocumentIdSchema,
  updatePartnerDocumentSchema,
} from '../schemas/partner-document.schemas.js';

import type { PartnerDocumentService } from '../services/partner-document.service.js';

export class PartnerDocumentController {
  constructor(private readonly service: PartnerDocumentService) {}

  list = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = partnerIdSchema.parse(request.params);

      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      const documents = await this.service.getDocuments(id, request.auth);

      response.json({
        success: true,
        data: documents,
        message: 'Partner documents retrieved',
      });
    } catch (error) {
      next(error);
    }
  };

  create = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = partnerIdSchema.parse(request.params);

      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      const input = createPartnerDocumentSchema.parse(request.body);

      const document = await this.service.createDocumentMetadata(id, input, request.auth);

      response.status(201).json({
        success: true,
        data: document,
        message: 'Document created',
      });
    } catch (error) {
      next(error);
    }
  };

  update = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, documentId } = partnerDocumentIdSchema.parse(request.params);

      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      const input = updatePartnerDocumentSchema.parse(request.body);

      const document = await this.service.updateDocumentMetadata(
        id,
        documentId,
        input,
        request.auth,
      );

      response.json({
        success: true,
        data: document,
        message: 'Document updated',
      });
    } catch (error) {
      next(error);
    }
  };
}
