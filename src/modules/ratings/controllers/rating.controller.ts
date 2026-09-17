import type { NextFunction, Request, Response } from 'express';
import type { RatingRepository } from '../repositories/rating.repository.js';
import { createRatingSchema, driverRatingQuerySchema } from '../schemas/rating.schemas.js';

export class RatingController {
  constructor(private readonly ratingRepository: RatingRepository) {}

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createRatingSchema.parse(req.body);
      const customerId = req.auth?.userId;

      if (!customerId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const rating = await this.ratingRepository.create({
        rideId: input.rideId,
        customerId,
        rating: input.rating,
        review: input.review,
      });

      res.status(201).json({
        success: true,
        data: rating,
        message: 'Rating submitted successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  getByRide = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rideId = req.params.rideId as string;
      const rating = await this.ratingRepository.findByRideId(rideId);

      res.json({
        success: true,
        data: rating,
      });
    } catch (error) {
      next(error);
    }
  };

  getDriverSummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = driverRatingQuerySchema.parse(req.params);
      const summary = await this.ratingRepository.getDriverSummary(query.driverProfileId);

      res.json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  };
}
