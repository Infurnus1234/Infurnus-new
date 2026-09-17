import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../../common/errors/app-error.js';
import {
  driverAvailabilitySchema,
  driverLocationSchema,
  upsertDriverProfileSchema,
} from '../schemas/driver.schemas.js';
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

  complete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = rideIdSchema.parse(req.params);
      const profileId = await this.driverService.profileForUser(req.auth!.userId);
      const ride = await this.rideService.completeRide(id, profileId);
      res.json({ success: true, data: ride, message: 'Ride completed' });
    } catch (error) {
      next(error);
    }
  };

  transition = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = rideIdSchema.parse(req.params);
      const profileId = await this.driverService.profileForUser(req.auth!.userId);
      const status = rideStatusSchema.parse(req.body.status);
      const pin = typeof req.body.pin === 'string' ? req.body.pin.trim() : undefined;
      const ride = await this.rideService.transitionRide(
        id,
        status,
        profileId,
        pin,
      );
      res.json({ success: true, data: ride, message: 'Ride status updated' });
    } catch (error) {
      next(error);
    }
  };

  verifyPin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = rideIdSchema.parse(req.params);
      const profileId = await this.driverService.profileForUser(req.auth!.userId);
      const pin = typeof req.body.pin === 'string' ? req.body.pin.trim() : '';
      if (!/^\d{4}$/.test(pin)) {
        throw new AppError('INVALID_PIN', 'PIN must be exactly 4 digits', 400);
      }
      const result = await this.rideService.verifyRidePin(id, profileId, pin);
      res.json({ success: true, data: result, message: 'PIN verified successfully' });
    } catch (error) {
      next(error);
    }
  };

  listAvailableRides = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rides = await this.rideService.listAvailableRides();
      res.json({ success: true, data: rides, message: 'Available rides retrieved' });
    } catch (error) {
      next(error);
    }
  };

  getProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await this.driverService.getProfile(req.auth!.userId);
      res.json({ success: true, data: profile, message: 'Driver profile retrieved' });
    } catch (error) {
      next(error);
    }
  };

  upsertProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = upsertDriverProfileSchema.parse(req.body);
      const profile = await this.driverService.upsertProfile(req.auth!.userId, input);
      res.json({ success: true, data: profile, message: 'Driver profile saved' });
    } catch (error) {
      next(error);
    }
  };

  history = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const history = await this.driverService.getDriverHistory(req.auth!.userId, limit);
      res.json({ success: true, data: history, message: 'Driver history retrieved' });
    } catch (error) {
      next(error);
    }
  };
}
