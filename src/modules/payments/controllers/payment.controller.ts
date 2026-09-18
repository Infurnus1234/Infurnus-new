import type { NextFunction, Request, Response } from 'express';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import type { RentalRepository } from '../../rentals/repositories/rental.repository.js';
import { capturePaymentSchema, initiatePaymentSchema } from '../schemas/payment.schemas.js';

export class PaymentController {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly rideRepository?: RideRepository,
    private readonly rentalRepository?: RentalRepository,
  ) {}

  initiate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = initiatePaymentSchema.parse(req.body);
      const userId = req.auth?.userId;
      const role = req.auth?.role;

      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      let amountToCharge: number;

      if (input.rideId) {
        if (!this.rideRepository) {
          res.status(500).json({ success: false, message: 'Ride repository unavailable' });
          return;
        }

        const ride = await this.rideRepository.findById(input.rideId);
        if (!ride) {
          res.status(404).json({ success: false, message: 'Ride not found' });
          return;
        }

        // 1. Ownership authorization: Customer of the ride or admin
        const isCustomer = ride.customerId === userId;
        const isAdmin = role === 'admin';
        if (!isCustomer && !isAdmin) {
          res.status(403).json({
            success: false,
            message: 'Forbidden: You can only initiate payment for your own ride',
          });
          return;
        }

        // 2. Lifecycle check: Cancelled rides cannot be paid
        if (ride.status === 'cancelled') {
          res.status(409).json({
            success: false,
            message: 'Cannot initiate payment for a cancelled ride',
          });
          return;
        }

        // 3. Duplicate/conflicting payment protection
        const existingPayments = await this.paymentRepository.findByRideId(input.rideId);
        const capturedPayment = existingPayments.find((p) => p.status === 'CAPTURED');
        if (capturedPayment) {
          res.status(409).json({
            success: false,
            message: 'Payment has already been captured for this ride',
          });
          return;
        }

        const activePayment = existingPayments.find(
          (p) => p.status === 'INITIATED' || p.status === 'AUTHORIZED',
        );
        if (activePayment) {
          if (input.idempotencyKey && activePayment.idempotencyKey === input.idempotencyKey) {
            res.status(200).json({
              success: true,
              data: activePayment,
              message: 'Payment already initiated',
            });
            return;
          }
          res.status(409).json({
            success: false,
            message: 'An active payment already exists for this ride',
          });
          return;
        }

        // 4. Server-side authoritative fare derivation (NEVER trust client amount)
        if (ride.sector === 'premium') {
          // For Premium rides, reconcile final fare including actual GPS distance-based fuel cost
          const bookedHours = Math.max(
            1,
            Number(ride.rentalDetails?.rentalHours ?? ride.rentalDetails?.hours ?? 1),
          );
          const hourlyRate = 1000;
          const hourlyBase = bookedHours * hourlyRate;
          const actualFuelCost = Number(ride.actualFuelCost ?? 0);
          const subtotal = hourlyBase + actualFuelCost;
          const taxAmount = Math.round(subtotal * 0.05 * 100) / 100;
          const reconciledFare = Math.round((subtotal + taxAmount) * 100) / 100;

          amountToCharge = Number(ride.finalFare ?? reconciledFare);
        } else {
          // For Passenger, Logistics, Service
          amountToCharge = Number(ride.finalFare ?? ride.fareEstimate);
        }

        if (isNaN(amountToCharge) || amountToCharge <= 0) {
          res.status(400).json({
            success: false,
            message: 'Authoritative ride fare could not be determined',
          });
          return;
        }
      } else if (input.rentalId) {
        if (this.rentalRepository) {
          const rental = await this.rentalRepository.findByIdForUser(input.rentalId, userId);
          if (!rental && role !== 'admin') {
            res.status(404).json({ success: false, message: 'Rental not found' });
            return;
          }
          amountToCharge = rental ? Number(rental.totalAmount) : (input.amount ?? 0);
        } else {
          amountToCharge = input.amount ?? 0;
        }

        if (isNaN(amountToCharge) || amountToCharge <= 0) {
          res.status(400).json({ success: false, message: 'Invalid payment amount' });
          return;
        }
      } else {
        amountToCharge = input.amount ?? 0;
        if (isNaN(amountToCharge) || amountToCharge <= 0) {
          res.status(400).json({ success: false, message: 'Invalid payment amount' });
          return;
        }
      }

      const payment = await this.paymentRepository.initiate({
        userId,
        rideId: input.rideId,
        rentalId: input.rentalId,
        logisticsOrderId: input.logisticsOrderId,
        amount: amountToCharge,
        currency: input.currency,
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
      });

      res.status(201).json({
        success: true,
        data: payment,
        message: 'Payment initiated successfully',
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        res.status(409).json({
          success: false,
          message: 'An active payment already exists for this ride or idempotency key',
        });
        return;
      }
      next(error);
    }
  };

  capture = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paymentId = req.params.paymentId as string;
      const input = capturePaymentSchema.parse(req.body);
      const userId = req.auth?.userId;
      const role = req.auth?.role;

      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const payment = await this.paymentRepository.findById(paymentId);
      if (!payment) {
        res.status(404).json({ success: false, message: 'Payment not found' });
        return;
      }

      // Authorization check: User owns this payment or is admin
      const isOwner = payment.userId === userId;
      const isAdmin = role === 'admin';
      if (!isOwner && !isAdmin) {
        res.status(403).json({
          success: false,
          message: 'Forbidden: Access denied to capture this payment',
        });
        return;
      }

      // Lifecycle status checks
      if (payment.status === 'CAPTURED') {
        res.json({
          success: true,
          data: payment,
          message: 'Payment captured successfully',
        });
        return;
      }

      if (payment.status === 'FAILED') {
        res.status(409).json({
          success: false,
          message: 'Cannot capture a failed payment',
        });
        return;
      }

      if (payment.status === 'REFUNDED') {
        res.status(409).json({
          success: false,
          message: 'Cannot capture a refunded payment',
        });
        return;
      }

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
      const userId = req.auth?.userId;
      const role = req.auth?.role;

      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const payment = await this.paymentRepository.findById(paymentId);

      if (!payment) {
        res.status(404).json({ success: false, message: 'Payment not found' });
        return;
      }

      // Authorization check: User owns this payment or is admin
      const isOwner = payment.userId === userId;
      const isAdmin = role === 'admin';
      if (!isOwner && !isAdmin) {
        res.status(403).json({
          success: false,
          message: 'Forbidden: Access denied to payment record',
        });
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
