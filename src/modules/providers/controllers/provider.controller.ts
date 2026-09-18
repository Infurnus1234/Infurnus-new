import type { NextFunction, Request, Response } from 'express';
import { upsertBankAccountSchema } from '../schemas/provider.schemas.js';
import type { ProviderService } from '../services/provider.service.js';

export class ProviderController {
  constructor(private readonly providerService: ProviderService) {}

  getBankAccount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bankAccount = await this.providerService.getBankAccount(req.auth!.userId);
      res.json({ success: true, data: bankAccount });
    } catch (error) {
      next(error);
    }
  };

  upsertBankAccount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = upsertBankAccountSchema.parse(req.body);
      const bankAccount = await this.providerService.upsertBankAccount(req.auth!.userId, input);
      res.json({
        success: true,
        data: bankAccount,
        message: 'Bank account details saved successfully',
      });
    } catch (error) {
      next(error);
    }
  };
}
