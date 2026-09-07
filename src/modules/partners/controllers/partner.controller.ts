import type { NextFunction, Request, Response } from 'express';
import {
  createPartnerSchema,
  partnerIdSchema,
  partnerListQuerySchema,
  updateAvailabilitySchema,
  updatePartnerSchema,
} from '../schemas/partner.schemas.js';
import type { PartnerService } from '../services/partner.service.js';

export class PartnerController {
  constructor(private readonly service: PartnerService) {}

  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.auth) throw new Error('Authentication middleware is required');
      const partner = await this.service.createPartner(
        createPartnerSchema.parse(request.body),
        request.auth,
      );
      response.status(201).json({ success: true, data: partner, message: 'Partner created' });
    } catch (error) {
      next(error);
    }
  };

  getById = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = partnerIdSchema.parse(request.params);
      if (!request.auth) throw new Error('Authentication middleware is required');
      const partner = await this.service.getPartner(id, request.auth);
      response.json({ success: true, data: partner, message: 'Partner retrieved' });
    } catch (error) {
      next(error);
    }
  };

  list = async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.auth) throw new Error('Authentication middleware is required');
      const partners = await this.service.listPartners(
        partnerListQuerySchema.parse(request.query),
        request.auth,
      );
      response.json({ success: true, data: partners, message: 'Partners retrieved' });
    } catch (error) {
      next(error);
    }
  };

  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = partnerIdSchema.parse(request.params);
      if (!request.auth) throw new Error('Authentication middleware is required');
      const partner = await this.service.updatePartner(
        id,
        updatePartnerSchema.parse(request.body),
        request.auth,
      );
      response.json({ success: true, data: partner, message: 'Partner updated' });
    } catch (error) {
      next(error);
    }
  };

  updateAvailability = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = partnerIdSchema.parse(request.params);
      const { availabilityStatus } = updateAvailabilitySchema.parse(request.body);
      if (!request.auth) throw new Error('Authentication middleware is required');
      const partner = await this.service.updatePartner(id, { availabilityStatus }, request.auth);
      response.json({ success: true, data: partner, message: 'Partner availability updated' });
    } catch (error) {
      next(error);
    }
  };
}
