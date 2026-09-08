import type { NextFunction, Request, Response } from 'express';
import {
  createRideSchema,
  cancelRideSchema,
  listRidesSchema,
  rideIdSchema,
} from '../schemas/ride.schemas.js';
import type { RideService } from '../services/ride.service.js';

export class RideController {
  constructor(private readonly service: RideService) {}

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ride = await this.service.createRide(
        req.auth!.userId,
        createRideSchema.parse(req.body),
      );
      res.status(201).json({ success: true, data: ride, message: 'Ride created' });
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rides = await this.service.listRides(
        req.auth!.userId,
        listRidesSchema.parse(req.query),
      );
      res.json({ success: true, data: rides, message: 'Rides retrieved' });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = rideIdSchema.parse(req.params);
      const ride = await this.service.getRide(req.auth!.userId, id);
      res.json({ success: true, data: ride, message: 'Ride retrieved' });
    } catch (error) {
      next(error);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = rideIdSchema.parse(req.params);
      const ride = await this.service.cancelRide(
        req.auth!.userId,
        id,
        cancelRideSchema.parse(req.body),
      );
      res.json({ success: true, data: ride, message: 'Ride cancelled' });
    } catch (error) {
      next(error);
    }
  };
}
