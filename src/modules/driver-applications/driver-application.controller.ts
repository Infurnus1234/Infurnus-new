import type { Request, Response } from 'express';

import {
  createDriverApplicationSchema,
  driverApplicationFiltersSchema,
  driverApplicationIdParamSchema,
  reviewDriverApplicationSchema,
} from './driver-application.schemas.js';

import { DriverApplicationService } from './driver-application.service.js';

export class DriverApplicationController {
  constructor(private readonly service: DriverApplicationService) {}

  private getAuth(req: Request) {
    if (!req.auth?.userId) {
      throw new Error('Authentication required.');
    }

    return req.auth;
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const body = createDriverApplicationSchema.parse(req.body);
    const auth = this.getAuth(req);

    const application = await this.service.create(auth, body);

    res.status(201).json({
      success: true,
      data: application,
    });
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    const { id } = driverApplicationIdParamSchema.parse(req.params);

    const auth = this.getAuth(req);

    const application = await this.service.getById(auth, id);

    res.status(200).json({
      success: true,
      data: application,
    });
  };

  getByDriverProfile = async (req: Request, res: Response): Promise<void> => {
    const { driverProfileId } = driverApplicationIdParamSchema
      .extend({
        driverProfileId: driverApplicationIdParamSchema.shape.id,
      })
      .omit({ id: true })
      .parse(req.params);

    const auth = this.getAuth(req);

    const application = await this.service.getByDriverProfileId(auth, driverProfileId);

    res.status(200).json({
      success: true,
      data: application,
    });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const parsed = driverApplicationFiltersSchema.parse(req.query);

    const filters = {
      ...(parsed.status !== undefined && {
        status: parsed.status,
      }),
      ...(parsed.requestedSector !== undefined && {
        requestedSector: parsed.requestedSector,
      }),
      ...(parsed.requestedVehicleCategory !== undefined && {
        requestedVehicleCategory: parsed.requestedVehicleCategory,
      }),
      ...(parsed.vehicleOwnershipType !== undefined && {
        vehicleOwnershipType: parsed.vehicleOwnershipType,
      }),
      ...(parsed.partnerId !== undefined && {
        partnerId: parsed.partnerId,
      }),
      ...(parsed.driverProfileId !== undefined && {
        driverProfileId: parsed.driverProfileId,
      }),
      ...(parsed.reviewedBy !== undefined && {
        reviewedBy: parsed.reviewedBy,
      }),
      ...(parsed.approvedBy !== undefined && {
        approvedBy: parsed.approvedBy,
      }),
      page: parsed.page,
      limit: parsed.limit,
    };

    const auth = this.getAuth(req);

    const result = await this.service.list(auth, filters);

    res.status(200).json({
      success: true,
      data: result.items,
      pagination: {
        page: parsed.page,
        limit: parsed.limit,
        total: result.total,
      },
    });
  };

  review = async (req: Request, res: Response): Promise<void> => {
    const { id } = driverApplicationIdParamSchema.parse(req.params);

    const parsed = reviewDriverApplicationSchema.parse(req.body);

    const review = {
      status: parsed.status,
      ...(parsed.reviewReason !== undefined && {
        reviewReason: parsed.reviewReason,
      }),
    };

    const auth = req.auth;

    if (!auth?.userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
      return;
    }

    const application = await this.service.review(id, review, auth.userId);

    res.status(200).json({
      success: true,
      data: application,
    });
  };
}
