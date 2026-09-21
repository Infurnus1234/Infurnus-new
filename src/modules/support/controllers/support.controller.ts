import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../../common/errors/app-error.js';
import { createSupportTicketSchema, supportTicketIdSchema } from '../schemas/support.schemas.js';
import type { SupportService } from '../services/support.service.js';

export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  createTicket = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = createSupportTicketSchema.parse(req.body);
      const role = req.auth?.role ?? 'driver';
      const ticket = await this.supportService.createTicket(req.auth!.userId, role, input);
      res.status(201).json({
        success: true,
        data: ticket,
        message: 'Support ticket created successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  listTickets = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tickets = await this.supportService.listTickets(req.auth!.userId);
      res.json({ success: true, data: tickets });
    } catch (error) {
      next(error);
    }
  };

  getTicket = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = supportTicketIdSchema.parse(req.params);
      const ticket = await this.supportService.getTicketById(req.auth!.userId, id);
      if (!ticket) {
        throw new AppError('TICKET_NOT_FOUND', 'Support ticket not found', 404);
      }
      res.json({ success: true, data: ticket });
    } catch (error) {
      next(error);
    }
  };
}
