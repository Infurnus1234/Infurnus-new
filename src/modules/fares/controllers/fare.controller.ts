import type { NextFunction, Request, Response } from 'express';
import { fareEstimateSchema } from '../../rides/schemas/ride.schemas.js';
import type { FareEstimateService } from '../services/fare-estimate.service.js';

export class FareController {
  constructor(private readonly fareEstimateService: FareEstimateService) {}

  estimate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = fareEstimateSchema.parse(req.body);

      const sector = input.sector;
      const vehicleCategory = input.vehicleCategory ?? input.serviceDetails?.serviceType;
      const waitingMinutes = input.waitingMinutes;
      const weightKg = input.weightKg ?? input.goods?.weightKg;
      const hasLoadingAssistance = input.hasLoadingAssistance ?? input.goods?.hasLoadingAssistance;
      const rentalHours = input.rentalHours ?? input.rentalDetails?.hours ?? input.serviceDetails?.workHours;
      const fuelRatePerKm = input.fuelRatePerKm ?? input.rentalDetails?.fuelRatePerKm;

      const hasOptions =
        sector !== undefined ||
        vehicleCategory !== undefined ||
        waitingMinutes !== undefined ||
        weightKg !== undefined ||
        hasLoadingAssistance !== undefined ||
        rentalHours !== undefined ||
        fuelRatePerKm !== undefined;

      const fare = hasOptions
        ? await this.fareEstimateService.estimate(input.pickup, input.destination, {
            sector,
            vehicleCategory,
            waitingMinutes,
            weightKg,
            hasLoadingAssistance,
            rentalHours,
            fuelRatePerKm,
          })
        : await this.fareEstimateService.estimate(input.pickup, input.destination);

      res.json({
        success: true,
        data: fare,
        message: 'Fare estimated',
      });
    } catch (error) {
      next(error);
    }
  };
}
