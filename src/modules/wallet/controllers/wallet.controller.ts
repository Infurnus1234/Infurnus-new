import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { PostgresWalletRepository } from '../repositories/wallet.repository.js';
import { AppError } from '../../../common/errors/app-error.js';

const topUpInitiateSchema = z.object({
  amount: z.number().min(10, 'Minimum top-up is ₹10').max(100000, 'Maximum top-up is ₹1,00,000'),
  paymentMethod: z.string().default('upi'),
  idempotencyKey: z.string().min(1, 'Idempotency key required'),
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
  idempotencyKey: z.string().min(1, 'Idempotency key required'),
  authConfirmation: z.string().optional(),
});

const resolveRecipientSchema = z.object({
  targetType: z.enum(['upi', 'driver', 'merchant', 'order']).default('upi'),
  targetId: z.string().min(1, 'Target ID is required'),
});

export class WalletController {
  constructor(private readonly repository: PostgresWalletRepository) {}

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
      const amountPaise = Math.round(input.amount * 100);
      const orderId = `order_topup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      res.json({
        success: true,
        data: {
          orderId,
          amount: input.amount,
          amountPaise,
          currency: 'INR',
          paymentMethod: input.paymentMethod,
          idempotencyKey: input.idempotencyKey,
          // Provider session details for checkout
          paymentSessionId: `session_${orderId}`,
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
      const amountPaise = Math.round(input.amount * 100);

      // Server verification step: credits wallet ONLY here
      const result = await this.repository.topUp(
        userId,
        amountPaise,
        input.paymentMethod,
        input.referenceId || input.orderId,
        input.idempotencyKey,
        `Top-Up via ${input.paymentMethod}`,
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

  pay = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const input = paySchema.parse(req.body);
      const amountPaise = Math.round(input.amount * 100);

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
