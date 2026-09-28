import type { NextFunction, Request, Response } from 'express';

import {
  adminIdSchema,
  adminDriverApplicationsQuerySchema,
  adminDriversQuerySchema,
  adminPartnersQuerySchema,
  adminUsersQuerySchema,
  adminVehiclesQuerySchema,
  fleetQuerySchema,
  reviewDriverApplicationSchema,
  updateUserStatusSchema,
  verifyDriverSchema,
  verifyVehicleSchema,
} from '../schemas/admin.schemas.js';

import type { DriverApplicationService } from '../../driver-applications/driver-application.service.js';
import type { AdminService } from '../services/admin.service.js';

export class AdminController {
  constructor(
    private readonly service: AdminService,
    private readonly driverApplicationService?: DriverApplicationService,
  ) {}

  listUsers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await this.service.listUsers(adminUsersQuerySchema.parse(req.query)),
      });
    } catch (error) {
      next(error);
    }
  };

  getUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await this.service.getUser(adminIdSchema.parse(req.params).id),
      });
    } catch (error) {
      next(error);
    }
  };

  updateUserStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = adminIdSchema.parse(req.params);
      const { status } = updateUserStatusSchema.parse(req.body);

      const data = await this.service.updateUserStatus(id, status);

      res.json({
        success: true,
        data,
        message: `User status updated to ${status}`,
      });
    } catch (error) {
      next(error);
    }
  };

  listPartners = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await this.service.listPartners(adminPartnersQuerySchema.parse(req.query)),
      });
    } catch (error) {
      next(error);
    }
  };

  getPartner = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await this.service.getPartner(adminIdSchema.parse(req.params).id),
      });
    } catch (error) {
      next(error);
    }
  };

  listVehicles = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await this.service.listVehicles(adminVehiclesQuerySchema.parse(req.query)),
      });
    } catch (error) {
      next(error);
    }
  };

  getVehicle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await this.service.getVehicle(adminIdSchema.parse(req.params).id),
      });
    } catch (error) {
      next(error);
    }
  };

  listDrivers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await this.service.listDrivers(adminDriversQuerySchema.parse(req.query)),
      });
    } catch (error) {
      next(error);
    }
  };

  getDriver = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = adminIdSchema.parse(req.params);

      res.json({
        success: true,
        data: await this.service.getDriver(id),
      });
    } catch (error) {
      next(error);
    }
  };

  listDriverApplications = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = adminDriverApplicationsQuerySchema.parse(req.query);

      const data = await this.service.listDriverApplications({
        ...query,
        applicationStatus: query.status,
      });

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  reviewDriverApplication = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!this.driverApplicationService) {
        throw new Error('Driver application service is not configured.');
      }

      const { id } = adminIdSchema.parse(req.params);

      const { status, reviewReason } = reviewDriverApplicationSchema.parse(req.body);

      const reviewerId = req.auth?.userId;

      if (!reviewerId) {
        throw new Error('Authenticated user is required.');
      }

      const result = await this.driverApplicationService.review(
        id,
        {
          status,
          ...(reviewReason !== undefined ? { reviewReason } : {}),
        },
        reviewerId,
      );

      res.json({
        success: true,
        data: result,
        message: `Driver application ${status.toLowerCase()}.`,
      });
    } catch (error) {
      next(error);
    }
  };

  dashboard = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await this.service.dashboard(),
      });
    } catch (error) {
      next(error);
    }
  };

  verifyDriver = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = adminIdSchema.parse(req.params);

      const { status, rejectionReason } = verifyDriverSchema.parse(req.body);

      const result = await this.service.verifyDriver(id, status, rejectionReason);

      res.json({
        success: true,
        data: result,
        message: `Driver verification status updated to ${status}`,
      });
    } catch (error) {
      next(error);
    }
  };

  verifyVehicle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = adminIdSchema.parse(req.params);

      const { status, rejectionReason } = verifyVehicleSchema.parse(req.body);

      const result = await this.service.verifyVehicle(id, status, rejectionReason);

      res.json({
        success: true,
        data: result,
        message: `Vehicle verification status updated to ${status}`,
      });
    } catch (error) {
      next(error);
    }
  };

  verifyDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = adminIdSchema.parse(req.params);
      const { status, comments } = req.body;

      const result = await this.service.verifyDocument(id, status, comments);

      res.json({
        success: true,
        data: result,
        message: `Document verification status updated to ${status}`,
      });
    } catch (error) {
      next(error);
    }
  };

  // --- Fleet Analytics Endpoints ---

  getFleetAnalyticsSummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = fleetQuerySchema.parse(req.query);

      const data = await this.service.getFleetAnalyticsSummary(filters);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  getStateFleetAnalytics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = fleetQuerySchema.parse(req.query);

      const data = await this.service.getStateFleetAnalytics(filters);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  getCityFleetAnalytics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = fleetQuerySchema.parse(req.query);

      const rawState = req.params.state;

      const state = (typeof rawState === 'string' ? rawState : filters.state) || 'Bihar';

      const data = await this.service.getCityFleetAnalytics(state, filters);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  getLiveFleetVehicles = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = fleetQuerySchema.parse(req.query);

      const data = await this.service.getLiveFleetVehicles(filters);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  getLiveFleetVehicleDetails = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = adminIdSchema.parse(req.params);

      const data = await this.service.getLiveFleetVehicleDetails(id);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}
