import type { NextFunction, Request, Response } from 'express';

import {
  createVehicleSchema,
  deactivateVehicleSchema,
  updateVehicleSchema,
  vehicleDriverQuerySchema,
  vehicleFleetQuerySchema,
  vehicleIdSchema,
} from '../schemas/vehicle.schemas.js';

import type { VehicleService } from '../services/vehicle.service.js';

export class VehicleController {
  constructor(private readonly service: VehicleService) {}

  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = createVehicleSchema.parse(request.body);

      const vehicle = await this.service.createVehicle(input);

      response.status(201).json({
        success: true,
        data: vehicle,
        message: 'Vehicle created',
      });
    } catch (error) {
      next(error);
    }
  };

  getById = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = vehicleIdSchema.parse(request.params);

      const vehicle = await this.service.getVehicle(id);

      response.json({
        success: true,
        data: vehicle,
        message: 'Vehicle retrieved',
      });
    } catch (error) {
      next(error);
    }
  };

  list = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = vehicleDriverQuerySchema.parse(request.query);

      const vehicles = await this.service.listVehicles(query);

      response.json({
        success: true,
        data: vehicles,
        message: 'Vehicles retrieved',
      });
    } catch (error) {
      next(error);
    }
  };

  getFleet = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = vehicleFleetQuerySchema.parse(request.query);

      const fleet = await this.service.listFleet(query);

      response.json({
        success: true,
        data: fleet,
        message: 'Fleet retrieved',
      });
    } catch (error) {
      next(error);
    }
  };

  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = vehicleIdSchema.parse(request.params);
      const input = updateVehicleSchema.parse(request.body);

      const vehicle = await this.service.updateVehicle(id, input);

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
      const { id } = vehicleIdSchema.parse(request.params);
      const input = deactivateVehicleSchema.parse(request.body);

      const vehicle = await this.service.deactivateVehicle(id, input);

      response.json({
        success: true,
        data: vehicle,
        message: 'Vehicle deactivated',
      });
    } catch (error) {
      next(error);
    }
  };
}
