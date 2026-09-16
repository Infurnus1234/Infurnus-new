import type { NextFunction, Request, Response } from 'express';
import { fareEstimateSchema } from '../../rides/schemas/ride.schemas.js';
import type { FareEstimateService } from '../services/fare-estimate.service.js';

export class FareController {
  constructor(private readonly fareEstimateService: FareEstimateService) {}

  estimate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = fareEstimateSchema.parse(req.body);

      const fare = await this.fareEstimateService.estimate(input.pickup, input.destination);

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
