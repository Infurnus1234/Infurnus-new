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

  list = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = partnerIdSchema.parse(request.params);
      if (!request.auth) throw new Error('Authentication middleware is required');
      const documents = await this.service.getDocuments(id, request.auth);
      response.json({ success: true, data: documents, message: 'Partner documents retrieved' });
    } catch (error) {
      next(error);
    }
  };

  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = partnerIdSchema.parse(request.params);
      if (!request.auth) throw new Error('Authentication middleware is required');
      const document = await this.service.createDocumentMetadata(
        id,
        createPartnerDocumentSchema.parse(request.body),
        request.auth,
      );
      response.status(201).json({ success: true, data: document, message: 'Document created' });
    } catch (error) {
      next(error);
    }
  };

  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id, documentId } = partnerDocumentIdSchema.parse(request.params);
      if (!request.auth) throw new Error('Authentication middleware is required');
      const document = await this.service.updateDocumentMetadata(
        id,
        documentId,
        updatePartnerDocumentSchema.parse(request.body),
        request.auth,
      );
      response.json({ success: true, data: document, message: 'Document updated' });
    } catch (error) {
      next(error);
    }
  };
}
