import type { NextFunction, Request, Response } from 'express';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import { capturePaymentSchema, initiatePaymentSchema } from '../schemas/payment.schemas.js';

export class PaymentController {
  constructor(private readonly paymentRepository: PaymentRepository) {}

  initiate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = initiatePaymentSchema.parse(req.body);
      const userId = req.auth?.userId;

      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const payment = await this.paymentRepository.initiate({
        userId,
        rideId: input.rideId,
        rentalId: input.rentalId,
        logisticsOrderId: input.logisticsOrderId,
        amount: input.amount,
        currency: input.currency,
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
      });

      res.status(201).json({
        success: true,
        data: payment,
        message: 'Payment initiated successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  capture = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paymentId = req.params.paymentId as string;
      const input = capturePaymentSchema.parse(req.body);

      const captured = await this.paymentRepository.capture({
        paymentId,
        providerPaymentId: input.providerPaymentId,
      });

      if (!captured) {
        res.status(404).json({ success: false, message: 'Payment not found' });
        return;
      }

      res.json({
        success: true,
        data: captured,
        message: 'Payment captured successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paymentId = req.params.paymentId as string;
      const payment = await this.paymentRepository.findById(paymentId);

      if (!payment) {
        res.status(404).json({ success: false, message: 'Payment not found' });
        return;
      }

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      next(error);
    }
  };

  listHistory = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const payments = await this.paymentRepository.listForUser(userId);
      res.json({
        success: true,
        data: payments,
      });
    } catch (error) {
      next(error);
    }
  };
}
