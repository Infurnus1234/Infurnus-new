import type { Pool } from 'pg';
import type { CreateSupportTicketInput } from '../schemas/support.schemas.js';
import type { SupportTicket } from '../types/support.js';

export interface SupportRepository {
  createTicket(
    userId: string,
    role: string,
    input: CreateSupportTicketInput,
  ): Promise<SupportTicket>;
  listTickets(userId: string): Promise<SupportTicket[]>;
  getTicketById(userId: string, ticketId: string): Promise<SupportTicket | null>;
}

export class PostgresSupportRepository implements SupportRepository {
  constructor(private readonly pool: Pool) {}

  async createTicket(
    userId: string,
    role: string,
    input: CreateSupportTicketInput,
  ): Promise<SupportTicket> {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const ticketNumber = `TCK-${Date.now().toString().slice(-4)}${randomSuffix}`;

    const result = await this.pool.query<{
      id: string;
      ticket_number: string;
      user_id: string;
      role: string;
      category: string;
      subject: string;
      message: string;
      status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO support_tickets (
         ticket_number, user_id, role, category, subject, message, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
       RETURNING id, ticket_number, user_id, role, category, subject, message,
                 status, created_at, updated_at`,
      [ticketNumber, userId, role, input.category, input.subject, input.message],
    );

    const row = result.rows[0];
    if (!row) throw new Error('Failed to create support ticket');

    return {
      id: row.id,
      ticketNumber: row.ticket_number,
      userId: row.user_id,
      role: row.role,
      category: row.category,
      subject: row.subject,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listTickets(userId: string): Promise<SupportTicket[]> {
    const result = await this.pool.query<{
      id: string;
      ticket_number: string;
      user_id: string;
      role: string;
      category: string;
      subject: string;
      message: string;
      status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, ticket_number, user_id, role, category, subject, message,
              status, created_at, updated_at
       FROM support_tickets
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      ticketNumber: row.ticket_number,
      userId: row.user_id,
      role: row.role,
      category: row.category,
      subject: row.subject,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getTicketById(userId: string, ticketId: string): Promise<SupportTicket | null> {
    const result = await this.pool.query<{
      id: string;
      ticket_number: string;
      user_id: string;
      role: string;
      category: string;
      subject: string;
      message: string;
      status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, ticket_number, user_id, role, category, subject, message,
              status, created_at, updated_at
       FROM support_tickets
       WHERE id = $1 AND user_id = $2`,
      [ticketId, userId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      ticketNumber: row.ticket_number,
      userId: row.user_id,
      role: row.role,
      category: row.category,
      subject: row.subject,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
