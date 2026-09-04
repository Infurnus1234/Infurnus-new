import type { NextFunction, Request, Response } from 'express';
import {
  createVehicleSchema,
  deactivateVehicleSchema,
  updateVehicleSchema,
  vehicleDriverQuerySchema,
  vehicleIdSchema,
} from '../schemas/vehicle.schemas.js';
import type { VehicleService } from '../services/vehicle.service.js';

export class VehicleController {
  constructor(private readonly service: VehicleService) {}

  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const vehicle = await this.service.createVehicle(createVehicleSchema.parse(request.body));
      response.status(201).json({ success: true, data: vehicle, message: 'Vehicle created' });
    } catch (error) {
      next(error);
    }
  };

  getById = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = vehicleIdSchema.parse(request.params);
      const vehicle = await this.service.getVehicle(id);
      response.json({ success: true, data: vehicle, message: 'Vehicle retrieved' });
    } catch (error) {
      next(error);
    }
  };

  list = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const vehicles = await this.service.listVehicles(
        vehicleDriverQuerySchema.parse(request.query),
      );
      response.json({ success: true, data: vehicles, message: 'Vehicles retrieved' });
    } catch (error) {
      next(error);
    }
  };

  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = vehicleIdSchema.parse(request.params);
      const vehicle = await this.service.updateVehicle(id, updateVehicleSchema.parse(request.body));
      response.json({ success: true, data: vehicle, message: 'Vehicle updated' });
    } catch (error) {
      next(error);
    }
  };

  deactivate = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { id } = vehicleIdSchema.parse(request.params);
      const vehicle = await this.service.deactivateVehicle(
        id,
        deactivateVehicleSchema.parse(request.body),
      );
      response.json({ success: true, data: vehicle, message: 'Vehicle deactivated' });
    } catch (error) {
      next(error);
    }
  };
}
