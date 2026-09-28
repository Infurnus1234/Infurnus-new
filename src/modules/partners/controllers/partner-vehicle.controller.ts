import type { NextFunction, Request, Response } from 'express';
import {
  createFleetVehicleSchema,
  fleetVehicleIdSchema,
  updateFleetVehicleSchema,
} from '../../fleet/schemas/fleet.schemas.js';
import type { PartnerVehicleService } from '../services/partner-vehicle.service.js';

export class PartnerVehicleController {
  constructor(private readonly service: PartnerVehicleService) {}

  list = async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      const vehicles = await this.service.listVehicles(request.auth);

      response.json({
        success: true,
        data: vehicles,
        message: 'Partner vehicles retrieved',
      });
    } catch (error) {
      next(error);
    }
  };

  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      const vehicle = await this.service.createVehicle(
        request.auth,
        createFleetVehicleSchema.parse(request.body),
      );

      response.status(201).json({
        success: true,
        data: vehicle,
        message: 'Vehicle created',
      });
    } catch (error) {
      next(error);
    }
  };

  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      const { id } = fleetVehicleIdSchema.parse(request.params);

      const vehicle = await this.service.updateVehicle(
        request.auth,
        id,
        updateFleetVehicleSchema.parse(request.body),
      );

      response.json({
        success: true,
        data: vehicle,
        message: 'Vehicle updated',
      });
    } catch (error) {
      next(error);
    }
  };

  deactivate = async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.auth) {
        throw new Error('Authentication middleware is required');
      }

      const { id } = fleetVehicleIdSchema.parse(request.params);

      const result = await this.service.deactivateVehicle(request.auth, id);

      response.json({
        success: true,
        data: result,
        message: 'Vehicle deactivated',
      });
    } catch (error) {
      next(error);
    }
  };
}
