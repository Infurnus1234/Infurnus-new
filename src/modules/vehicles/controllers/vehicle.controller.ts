import { z } from 'zod';
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

  catalog = async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const query = z
        .object({
          sector: z.enum(['passenger', 'premium', 'logistics', 'service', 'rental']),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .strict()
        .parse(request.query);
      response.json({
        success: true,
        data: await this.service.catalog(query.sector, query.limit, query.offset),
      });
    } catch (error) {
      next(error);
    }
  };

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

      await this.service.assertReadAccess(request.auth!, id);

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

      await this.service.assertReadAccess(request.auth!, undefined, query.driverProfileId);

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
