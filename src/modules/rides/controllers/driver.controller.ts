import type { NextFunction, Request, Response } from 'express';
import { driverAvailabilitySchema, driverLocationSchema } from '../schemas/driver.schemas.js';
import { rideIdSchema, rideStatusSchema } from '../schemas/ride.schemas.js';
import type { DriverService } from '../services/driver.service.js';
import type { RideService } from '../services/ride.service.js';

export class DriverController {
  constructor(
    private readonly driverService: DriverService,
    private readonly rideService: RideService,
  ) {}

  availability = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.driverService.updateAvailability(
        req.auth!.userId,
        driverAvailabilitySchema.parse(req.body),
      );
      res.json({ success: true, message: 'Driver availability updated' });
    } catch (error) {
      next(error);
    }
  };

  location = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.driverService.updateLocation(
        req.auth!.userId,
        driverLocationSchema.parse(req.body),
      );
      res.json({ success: true, message: 'Driver location updated' });
    } catch (error) {
      next(error);
    }
  };

  accept = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = rideIdSchema.parse(req.params);
      const profileId = await this.driverService.profileForUser(req.auth!.userId);
      const ride = await this.rideService.acceptRide(profileId, id);
      res.json({ success: true, data: ride, message: 'Ride accepted' });
    } catch (error) {
      next(error);
    }
  };

  transition = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = rideIdSchema.parse(req.params);
      const profileId = await this.driverService.profileForUser(req.auth!.userId);
      const ride = await this.rideService.transitionRide(
        id,
        rideStatusSchema.parse(req.body.status),
        profileId,
      );
      res.json({ success: true, data: ride, message: 'Ride status updated' });
    } catch (error) {
      next(error);
    }
  };
}
