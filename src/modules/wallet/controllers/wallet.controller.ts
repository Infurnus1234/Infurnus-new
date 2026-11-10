import { wholeRupees, rupeesToPaise, sameMoney } from '../../../common/utils/whole-rupee.js';
import type { PaymentProvider } from '../../payments/providers/payment.provider.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { PostgresWalletRepository } from '../repositories/wallet.repository.js';

const topUpInitiateSchema = z.object({
  amount: z.number().min(10, 'Minimum top-up is ₹10').max(100000, 'Maximum top-up is ₹1,00,000'),
  paymentMethod: z.string().default('upi'),
  idempotencyKey: z.string().min(1, 'Idempotency key required').max(100),
});

const topUpVerifySchema = z.object({
  orderId: z.string().min(1),
  referenceId: z.string().optional(),
  amount: z.number().positive(),
  paymentMethod: z.string().default('UPI'),
  idempotencyKey: z.string().min(1),
});

const paySchema = z.object({
  targetType: z.enum(['upi', 'driver', 'merchant', 'order']),
  targetId: z.string().min(1),
  amount: z.number().positive('Payment amount must be greater than zero'),
  note: z.string().max(200).optional(),
  idempotencyKey: z.string().min(1, 'Idempotency key required').max(100),
  authConfirmation: z.string().optional(),
});

const resolveRecipientSchema = z.object({
  targetType: z.enum(['upi', 'driver', 'merchant', 'order']).default('upi'),
  targetId: z.string().min(1, 'Target ID is required'),
});

export class WalletController {
  constructor(
    private readonly repository: PostgresWalletRepository,
    private readonly provider?: PaymentProvider,
  ) {}

  getWallet = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const wallet = await this.repository.getWallet(userId);
      res.json({
        success: true,
        data: wallet,
      });
    } catch (error) {
      next(error);
    }
  };

  getHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const type = (req.query.type as string)?.toLowerCase();
      const validFilter = type === 'credit' || type === 'debit' ? type : 'all';
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const result = await this.repository.getHistory(userId, {
        type: validFilter,
        limit,
        offset,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  initiateTopUp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const input = topUpInitiateSchema.parse(req.body);
      const roundedPaise = wholeRupees(input.amount) * 100;
      if (!this.provider)
        throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Wallet checkout is unavailable', 503);
      const stored = await this.repository.createTopUpOrder(
        userId,
        roundedPaise,
        input.idempotencyKey,
        rupeesToPaise(input.amount),
      );
      const amountPaise = Number(stored.amountPaise);
      const orderId = stored.orderId;
      const order = await this.provider.createOrder({
        orderId,
        amount: amountPaise / 100,
        currency: 'INR',
        customerId: userId,
        orderNote: 'INFURNUS Wallet Top-Up',
      });
      if (
        order.providerOrderId !== orderId ||
        !order.paymentSessionId ||
        order.orderCurrency !== 'INR' ||
        !sameMoney(order.orderAmount, amountPaise / 100)
      )
        throw new AppError(
          'PAYMENT_PROVIDER_UNAVAILABLE',
          'Wallet checkout session unavailable',
          502,
        );

      res.json({
        success: true,
        data: {
          orderId,
          amount: amountPaise / 100,
          amountPaise,
          currency: 'INR',
          paymentMethod: input.paymentMethod,
          idempotencyKey: input.idempotencyKey,
          // Provider session details for checkout
          paymentSessionId: order.paymentSessionId,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  verifyTopUp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const input = topUpVerifySchema.parse(req.body);
      if (!this.provider)
        throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'Wallet verification unavailable', 503);
      const order = await this.repository.findTopUpOrder(userId, input.orderId);
      if (!order) throw new AppError('TOPUP_NOT_FOUND', 'Wallet top-up order not found', 404);
      const status = await this.provider.getPaymentStatus(order.orderId);
      const amountPaise = Number(order.amountPaise);
      if (
        status.orderStatus !== 'PAID' ||
        status.providerOrderId !== order.orderId ||
        status.orderCurrency !== 'INR' ||
        !sameMoney(status.orderAmount, amountPaise / 100) ||
        !status.providerPaymentId
      )
        throw new AppError(
          'PAYMENT_VERIFICATION_REQUIRED',
          'A matching paid gateway transaction is required',
          409,
        );
      const result = await this.repository.topUp(
        userId,
        amountPaise,
        'CASHFREE',
        status.providerPaymentId,
        order.orderId,
        'Verified wallet top-up',
      );

      res.json({
        success: true,
        message: 'Wallet top-up verified and credited successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  quotePayment = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const input = z
        .object({ amount: z.number().positive().max(99999999) })
        .strict()
        .parse(req.body);
      const amount = wholeRupees(input.amount);
      if (!amount)
        throw new AppError('INVALID_AMOUNT', 'Rounded payment amount must be positive', 400);
      res.json({ success: true, data: { amount, currency: 'INR' } });
    } catch (error) {
      next(error);
    }
  };

  pay = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const input = paySchema.parse(req.body);
      const amountPaise = wholeRupees(input.amount) * 100;

      const result = await this.repository.pay(
        userId,
        amountPaise,
        {
          type: input.targetType,
          id: input.targetId,
          orderId: input.targetType === 'order' ? input.targetId : undefined,
        },
        input.idempotencyKey,
        input.note,
      );

      res.json({
        success: true,
        message: 'Payment completed successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  resolveRecipient = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = resolveRecipientSchema.parse(req.body);
      const details = await this.repository.resolveRecipient(input.targetType, input.targetId);

      res.json({
        success: true,
        data: details,
      });
    } catch (error) {
      next(error);
    }
  };
}
