import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../../common/errors/app-error.js';
import {
  createFleetVehicleSchema,
  fleetVehicleIdSchema,
  updateFleetVehicleSchema,
} from '../schemas/fleet.schemas.js';
import type { FleetService } from '../services/fleet.service.js';

export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  getDashboard = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const metrics = await this.fleetService.getDashboard(req.auth!.userId);
      res.json({ success: true, data: metrics });
    } catch (error) {
      next(error);
    }
  };

  listVehicles = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vehicles = await this.fleetService.listVehicles(req.auth!.userId);
      res.json({ success: true, data: vehicles });
    } catch (error) {
      next(error);
    }
  };

  createVehicle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createFleetVehicleSchema.parse(req.body);
      const vehicle = await this.fleetService.createVehicle(req.auth!.userId, input);
      res.status(201).json({ success: true, data: vehicle, message: 'Vehicle created successfully' });
    } catch (error) {
      next(error);
    }
  };

  updateVehicle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = fleetVehicleIdSchema.parse(req.params);
      const input = updateFleetVehicleSchema.parse(req.body);
      const updated = await this.fleetService.updateVehicle(req.auth!.userId, id, input);
      if (!updated) {
        throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found or unauthorized', 404);
      }
      res.json({ success: true, data: updated, message: 'Vehicle updated successfully' });
    } catch (error) {
      next(error);
    }
  };

  deactivateVehicle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = fleetVehicleIdSchema.parse(req.params);
      const ok = await this.fleetService.deactivateVehicle(req.auth!.userId, id);
      if (!ok) {
        throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found or already deactivated', 404);
      }
      res.json({ success: true, message: 'Vehicle deactivated successfully' });
    } catch (error) {
      next(error);
    }
  };

  generateAssignmentCode = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = fleetVehicleIdSchema.parse(req.params);
      const result = await this.fleetService.generateAssignmentCode(req.auth!.userId, id);
      res.json({ success: true, data: result, message: 'Assignment code generated' });
    } catch (error) {
      next(error);
    }
  };

  unassignDriver = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = fleetVehicleIdSchema.parse(req.params);
      await this.fleetService.unassignDriver(req.auth!.userId, id);
      res.json({ success: true, message: 'Driver unassigned from vehicle' });
    } catch (error) {
      next(error);
    }
  };

  listDrivers = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const drivers = await this.fleetService.listDrivers(req.auth!.userId);
      res.json({ success: true, data: drivers });
    } catch (error) {
      next(error);
    }
  };

  listTrips = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const trips = await this.fleetService.listTrips(req.auth!.userId, limit);
      res.json({ success: true, data: trips });
    } catch (error) {
      next(error);
    }
  };

  getEarnings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const earnings = await this.fleetService.getEarnings(req.auth!.userId);
      res.json({ success: true, data: earnings });
    } catch (error) {
      next(error);
    }
  };
}
