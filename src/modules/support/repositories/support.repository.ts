import type { Pool } from 'pg';
import { AppError } from '../../../common/errors/app-error.js';
import {
  supportStatusUpdateSchema,
  supportTransitions,
  type CreateSupportTicketInput,
  type SupportListQuery,
} from '../schemas/support.schemas.js';
import type { SupportTicket } from '../types/support.js';

export interface SupportRepository {
  createTicket(
    userId: string,
    role: string,
    input: CreateSupportTicketInput,
  ): Promise<SupportTicket>;
  listTickets(userId: string, query?: SupportListQuery): Promise<SupportTicket[]>;
  getTicketById(userId: string, ticketId: string): Promise<SupportTicket | null>;
}
const columns =
  'id,ticket_number,user_id,role,category,subject,message,status,version,created_at,updated_at';
type SupportRow = {
  id: string;
  ticket_number: string;
  user_id: string;
  role: string;
  category: string;
  subject: string;
  message: string;
  status: SupportTicket['status'];
  version: number;
  created_at: Date;
  updated_at: Date;
};
function ticket(row: SupportRow): SupportTicket {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    userId: row.user_id,
    role: row.role,
    category: row.category,
    subject: row.subject,
    message: row.message,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export class PostgresSupportRepository implements SupportRepository {
  constructor(private readonly pool: Pool) {}
  async createTicket(
    userId: string,
    role: string,
    input: CreateSupportTicketInput,
  ): Promise<SupportTicket> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        `INSERT INTO support_tickets
        (user_id,role,category,subject,message,request_id) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT (user_id,request_id) DO NOTHING RETURNING ${columns}`,
        [userId, role, input.category, input.subject, input.message, input.requestId ?? null],
      );
      let row = created.rows[0];
      if (!row) {
        const existing = await client.query(
          `SELECT ${columns} FROM support_tickets WHERE user_id=$1 AND request_id=$2`,
          [userId, input.requestId],
        );
        row = existing.rows[0];
        if (
          !row ||
          row.subject !== input.subject ||
          row.message !== input.message ||
          row.category !== input.category
        )
          throw new AppError(
            'TICKET_REQUEST_CONFLICT',
            'This submission identifier was already used for a different ticket',
            409,
          );
      } else {
        await client.query(
          `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata)
          VALUES($1,'support_ticket_created','support_ticket',$2,$3)`,
          [userId, row.id, JSON.stringify({ ticketNumber: row.ticket_number, status: 'OPEN' })],
        );
      }
      await client.query('COMMIT');
      return ticket(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async listTickets(
    userId: string,
    query: SupportListQuery = { page: 1, pageSize: 25 },
  ): Promise<SupportTicket[]> {
    const result = await this.pool.query(
      `SELECT ${columns} FROM support_tickets WHERE user_id=$1
      ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
      [
        userId,
        query.pageSize + (query.includePagination === 'true' ? 1 : 0),
        (query.page - 1) * query.pageSize,
      ],
    );
    return result.rows.map(ticket);
  }
  async getTicketById(userId: string, identifier: string): Promise<SupportTicket | null> {
    const isId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identifier);
    const result = await this.pool.query(
      `SELECT ${columns} FROM support_tickets WHERE ${isId ? 'id' : 'ticket_number'}=$1`,
      [identifier],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.user_id !== userId)
      throw new AppError('TICKET_FORBIDDEN', 'You may only access your own support tickets', 403);
    return ticket(row);
  }
  async updateStatus(id: string, input: unknown, actorId?: string) {
    const update = supportStatusUpdateSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT ${columns} FROM support_tickets WHERE id=$1 FOR UPDATE`,
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new AppError('TICKET_NOT_FOUND', 'Support ticket not found', 404);
      if (row.version !== update.expectedVersion)
        throw new AppError(
          'TICKET_UPDATE_CONFLICT',
          'Ticket has changed; refresh before updating',
          409,
        );
      if (row.status === update.status) {
        await client.query('COMMIT');
        return row;
      }
      if (!supportTransitions[row.status]?.includes(update.status))
        throw new AppError(
          'TICKET_INVALID_TRANSITION',
          `Cannot change ticket status from ${row.status} to ${update.status}`,
          409,
        );
      const saved = await client.query(
        `UPDATE support_tickets SET status=$2,version=version+1,updated_at=NOW()
        WHERE id=$1 AND version=$3 RETURNING ${columns}`,
        [id, update.status, update.expectedVersion],
      );
      if (actorId)
        await client.query(
          `INSERT INTO user_history(user_id,event_type,entity_type,entity_id,metadata)
        VALUES($1,'support_ticket_status_changed','support_ticket',$2,$3)`,
          [
            actorId,
            id,
            JSON.stringify({ from: row.status, to: update.status, version: saved.rows[0].version }),
          ],
        );
      await client.query('COMMIT');
      return saved.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
