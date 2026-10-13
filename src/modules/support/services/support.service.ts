import type { SupportRepository } from '../repositories/support.repository.js';
import type { CreateSupportTicketInput, SupportListQuery } from '../schemas/support.schemas.js';
import type { SupportTicket } from '../types/support.js';

export class SupportService {
  constructor(private readonly supportRepo: SupportRepository) {}

  async createTicket(
    userId: string,
    role: string,
    input: CreateSupportTicketInput,
  ): Promise<SupportTicket> {
    return this.supportRepo.createTicket(userId, role, input);
  }

  async listTickets(userId: string, query?: SupportListQuery): Promise<SupportTicket[]> {
    return this.supportRepo.listTickets(userId, query);
  }

  async getTicketById(userId: string, ticketId: string): Promise<SupportTicket | null> {
    return this.supportRepo.getTicketById(userId, ticketId);
  }
}
