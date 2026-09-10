import type { NextFunction, Request, Response } from 'express';
import {
  createRentalSchema,
  cancelRentalSchema,
  listRentalsSchema,
  rentalIdSchema,
} from '../schemas/rental.schemas.js';
import type { RentalService } from '../services/rental.service.js';

export class RentalController {
  constructor(private readonly service: RentalService) {}

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idempotencyKey = req.get('Idempotency-Key')?.trim();

      if (!idempotencyKey) {
        res.status(400).json({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'Idempotency-Key header is required',
          },
        });
        return;
      }

      if (idempotencyKey.length > 255) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_IDEMPOTENCY_KEY',
            message: 'Idempotency-Key must be 255 characters or fewer',
          },
        });
        return;
      }

      const rental = await this.service.createRental(
        req.auth!.userId,
        createRentalSchema.parse(req.body),
        idempotencyKey,
      );

      res.status(201).json({
        success: true,
        data: rental,
        message: 'Rental created',
      });
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rentals = await this.service.listRentals(
        req.auth!.userId,
        listRentalsSchema.parse(req.query),
      );

      res.json({
        success: true,
        data: rentals,
        message: 'Rentals retrieved',
      });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = rentalIdSchema.parse(req.params);

      const rental = await this.service.getRental(req.auth!.userId, id);

      res.json({
        success: true,
        data: rental,
        message: 'Rental retrieved',
      });
    } catch (error) {
      next(error);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = rentalIdSchema.parse(req.params);

      const rental = await this.service.cancelRental(
        req.auth!.userId,
        id,
        cancelRentalSchema.parse(req.body),
      );

      res.json({
        success: true,
        data: rental,
        message: 'Rental cancelled',
      });
    } catch (error) {
      next(error);
    }
  };
}
