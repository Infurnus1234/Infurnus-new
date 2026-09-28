import type { Request, Response } from 'express';

import {
  partnerDriverStatusSchema,
  partnerDriverIdParamSchema,
  partnerDriverListQuerySchema,
} from '../schemas/partner-driver.schemas.js';

import type { PartnerDriverService } from '../services/partner-driver.service.js';

export class PartnerDriverController {
  constructor(private readonly service: PartnerDriverService) {}

  private getAuth(req: Request) {
    if (!req.auth?.userId) {
      throw new Error('Authentication required.');
    }

    return req.auth;
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const query = partnerDriverListQuerySchema.parse(req.query);

    const auth = this.getAuth(req);

    const drivers = await this.service.listDrivers(auth, query.status);

    res.status(200).json({
      success: true,
      data: drivers,
    });
  };

  updateStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = partnerDriverIdParamSchema.parse(req.params);

    const body = partnerDriverStatusSchema.parse(req.body);

    const auth = this.getAuth(req);

    const relationship = await this.service.updateStatus(auth, id, body.status);

    res.status(200).json({
      success: true,
      data: relationship,
    });
  };
}
