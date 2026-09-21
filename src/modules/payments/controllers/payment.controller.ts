import type { NextFunction, Request, Response } from 'express';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { RideRepository } from '../../rides/repositories/ride.repository.js';
import type { RentalRepository } from '../../rentals/repositories/rental.repository.js';
import type { PaymentProvider } from '../providers/payment.provider.js';
import type { Payment } from '../types/payment.js';
import {
  capturePaymentSchema,
  initiatePaymentSchema,
  refundPaymentSchema,
} from '../schemas/payment.schemas.js';

export class PaymentController {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly rideRepository?: RideRepository,
    private readonly rentalRepository?: RentalRepository,
    private readonly paymentProvider?: PaymentProvider,
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

      if (input.provider === 'cashfree' && !this.paymentProvider) {
        res.status(503).json({
          success: false,
          message: 'Payment provider cashfree is not configured or unavailable',
        });
        return;
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

      let paymentSessionId: string | null = null;
      let providerOrderId: string | null = null;

      if (input.provider === 'cashfree' && this.paymentProvider) {
        try {
          const orderResult = await this.paymentProvider.createOrder({
            orderId: `order_${payment.id}`,
            amount: payment.amount,
            currency: payment.currency,
            customerId: userId,
            orderNote: input.rideId
              ? `INFURNUS Ride ${input.rideId}`
              : input.rentalId
                ? `INFURNUS Rental ${input.rentalId}`
                : 'INFURNUS Order',
          });

          paymentSessionId = orderResult.paymentSessionId ?? null;
          providerOrderId = orderResult.providerOrderId;

          if (this.paymentRepository.updateProviderOrder) {
            await this.paymentRepository.updateProviderOrder(payment.id, providerOrderId);
          }
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : 'Payment gateway order creation failed';
          res.status(502).json({
            success: false,
            message,
          });
          return;
        }
      }

      res.status(201).json({
        success: true,
        data: {
          ...payment,
          providerOrderId: providerOrderId ?? payment.providerOrderId,
          paymentSessionId,
        },
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

      let effectiveProviderPaymentId = input.providerPaymentId;

      if (payment.provider === 'cashfree' && this.paymentProvider && payment.providerOrderId) {
        try {
          const statusResult = await this.paymentProvider.getPaymentStatus(payment.providerOrderId);

          // Reconcile amount where available
          if (
            statusResult.orderAmount !== undefined &&
            !isNaN(statusResult.orderAmount) &&
            Math.abs(Number(statusResult.orderAmount) - Number(payment.amount)) > 0.01
          ) {
            res.status(400).json({
              success: false,
              message: `Payment amount mismatch: gateway expected ${statusResult.orderAmount}, payment is ${payment.amount}`,
            });
            return;
          }

          if (statusResult.orderStatus === 'FAILED') {
            if (this.paymentRepository.markFailed) {
              await this.paymentRepository.markFailed(
                payment.id,
                'Cashfree reported payment failure',
              );
            }
            res.status(400).json({
              success: false,
              message: 'Payment cannot be captured: Cashfree order status is FAILED',
            });
            return;
          }

          if (statusResult.orderStatus === 'EXPIRED' || statusResult.orderStatus === 'TERMINATED') {
            if (this.paymentRepository.markFailed) {
              await this.paymentRepository.markFailed(
                payment.id,
                `Cashfree order ${statusResult.orderStatus.toLowerCase()}`,
              );
            }
            res.status(400).json({
              success: false,
              message: `Payment cannot be captured: Cashfree order status is ${statusResult.orderStatus}`,
            });
            return;
          }

          if (statusResult.orderStatus !== 'PAID') {
            res.status(400).json({
              success: false,
              message: `Payment cannot be captured: Cashfree order status is ${statusResult.orderStatus}`,
            });
            return;
          }
          if (!effectiveProviderPaymentId && statusResult.providerPaymentId) {
            effectiveProviderPaymentId = statusResult.providerPaymentId;
          }
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : 'Failed to verify Cashfree payment status';
          res.status(502).json({
            success: false,
            message,
          });
          return;
        }
      }

      const captured = await this.paymentRepository.capture({
        paymentId,
        providerPaymentId: effectiveProviderPaymentId,
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

  handleCashfreeWebhook = async (req: Request, res: Response, _next: NextFunction) => {
    try {
      if (!this.paymentProvider) {
        res.status(503).json({ success: false, message: 'Payment provider unavailable' });
        return;
      }

      const signature = req.headers['x-webhook-signature'] as string | undefined;
      const timestamp = req.headers['x-webhook-timestamp'] as string | undefined;

      if (!signature) {
        res.status(400).json({ success: false, message: 'Missing webhook signature' });
        return;
      }

      const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

      if (this.paymentProvider.verifyWebhookSignature) {
        const isValid = this.paymentProvider.verifyWebhookSignature(rawBody, signature, timestamp);
        if (!isValid) {
          res.status(401).json({ success: false, message: 'Invalid webhook signature' });
          return;
        }
      }

      const event = req.body as {
        type?: string;
        event_time?: string;
        data?: {
          order?: {
            order_id?: string;
            order_amount?: number;
            order_currency?: string;
          };
          payment?: {
            cf_payment_id?: string | number;
            payment_status?: string;
            payment_amount?: number;
            payment_currency?: string;
            payment_message?: string;
            payment_time?: string;
          };
        };
      };

      const orderId = event?.data?.order?.order_id;
      if (!orderId) {
        res.status(400).json({ success: false, message: 'Missing order_id in webhook payload' });
        return;
      }

      // Locate existing payment record by provider_order_id or id
      let payment: Payment | null = null;
      if (this.paymentRepository.findByProviderOrderId) {
        payment = await this.paymentRepository.findByProviderOrderId(orderId);
      }
      if (!payment) {
        const strippedId = orderId.replace(/^order_/, '');
        payment = await this.paymentRepository.findById(strippedId);
      }

      if (!payment) {
        // Safe diagnostic response without sensitive secrets. Never create unauthorized payment.
        res.status(200).json({
          success: true,
          message: 'Payment record not found for webhook order, ignored safely',
        });
        return;
      }

      const eventType = event.type ?? '';
      const paymentStatus = event.data?.payment?.payment_status?.toUpperCase() ?? '';
      const cfPaymentId = event.data?.payment?.cf_payment_id
        ? String(event.data.payment.cf_payment_id)
        : undefined;
      const webhookAmount = Number(event.data?.payment?.payment_amount);

      // Handle SUCCESS / PAID
      if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' || paymentStatus === 'SUCCESS') {
        // 1. Idempotency check: Already CAPTURED
        if (payment.status === 'CAPTURED') {
          res.status(200).json({
            success: true,
            data: payment,
            message: 'Payment already captured',
          });
          return;
        }

        // 2. Prevent illegal transition if already REFUNDED
        if (payment.status === 'REFUNDED') {
          res.status(200).json({
            success: true,
            message: 'Payment is already refunded, webhook ignored',
          });
          return;
        }

        // 3. Amount reconciliation check
        if (!isNaN(webhookAmount) && Math.abs(webhookAmount - payment.amount) > 0.01) {
          res.status(400).json({
            success: false,
            message: `Amount mismatch in webhook: expected ${payment.amount}, received ${webhookAmount}`,
          });
          return;
        }

        // 4. Capture payment
        const captured = await this.paymentRepository.capture({
          paymentId: payment.id,
          providerPaymentId: cfPaymentId,
        });

        res.status(200).json({
          success: true,
          data: captured,
          message: 'Payment captured successfully via webhook',
        });
        return;
      }

      // Handle FAILED
      if (eventType === 'PAYMENT_FAILED_WEBHOOK' || paymentStatus === 'FAILED') {
        if (payment.status === 'CAPTURED') {
          res.status(200).json({
            success: true,
            message: 'Payment already captured, failure webhook ignored',
          });
          return;
        }

        if (this.paymentRepository.markFailed) {
          await this.paymentRepository.markFailed(
            payment.id,
            event.data?.payment?.payment_message || 'Payment failed at gateway',
          );
        }

        res.status(200).json({
          success: true,
          message: 'Payment marked failed via webhook',
        });
        return;
      }

      // Other events (e.g. USER_DROPPED, PENDING)
      res.status(200).json({
        success: true,
        message: `Webhook event ${eventType} processed`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Internal webhook error';
      res.status(500).json({ success: false, message });
    }
  };

  refund = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paymentId = req.params.paymentId as string;
      const input = refundPaymentSchema.parse(req.body);
      const role = req.auth?.role;

      // Admin-only authorization
      if (role !== 'admin') {
        res.status(403).json({
          success: false,
          message: 'Forbidden: Only administrators can process refunds',
        });
        return;
      }

      const payment = await this.paymentRepository.findById(paymentId);
      if (!payment) {
        res.status(404).json({ success: false, message: 'Payment not found' });
        return;
      }

      // Must be CAPTURED
      if (payment.status === 'REFUNDED') {
        res.status(409).json({
          success: false,
          message: 'Payment has already been refunded',
        });
        return;
      }

      if (payment.status !== 'CAPTURED') {
        res.status(409).json({
          success: false,
          message: `Cannot refund payment in ${payment.status} state`,
        });
        return;
      }

      // Validate amount
      if (input.amount > payment.amount) {
        res.status(400).json({
          success: false,
          message: `Refund amount (${input.amount}) cannot exceed payment amount (${payment.amount})`,
        });
        return;
      }

      // Call gateway if provider is cashfree
      if (payment.provider === 'cashfree' && this.paymentProvider && payment.providerOrderId) {
        if (this.paymentProvider.refundPayment) {
          try {
            await this.paymentProvider.refundPayment({
              providerOrderId: payment.providerOrderId,
              refundAmount: input.amount,
              refundId: `ref_${payment.id}_${Date.now()}`,
              ...(input.reason ? { note: input.reason } : {}),
            });
          } catch (gatewayErr: unknown) {
            const message =
              gatewayErr instanceof Error ? gatewayErr.message : 'Gateway refund failed';
            res.status(502).json({
              success: false,
              message,
            });
            return;
          }
        }
      }

      // Update database
      if (!this.paymentRepository.refund) {
        res.status(500).json({ success: false, message: 'Refund repository not supported' });
        return;
      }

      const refunded = await this.paymentRepository.refund(paymentId, input.amount, input.reason);

      res.status(200).json({
        success: true,
        data: refunded,
        message: 'Payment refunded successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
