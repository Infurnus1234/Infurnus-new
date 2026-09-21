import type { NextFunction, Request, Response } from 'express';
import {
  adminIdSchema,
  adminPartnersQuerySchema,
  adminUsersQuerySchema,
  adminVehiclesQuerySchema,
} from '../schemas/admin.schemas.js';
import type { AdminService } from '../services/admin.service.js';

export class AdminController {
  constructor(private readonly service: AdminService) {}

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

  dashboard = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await this.service.dashboard() });
    } catch (error) {
      next(error);
    }
  };

  verifyDriver = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = adminIdSchema.parse(req.params);
      const { status, rejectionReason } = req.body;
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
      const { status, rejectionReason } = req.body;
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
}
