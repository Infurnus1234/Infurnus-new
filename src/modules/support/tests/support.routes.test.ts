import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { signAccessToken } from '../../auth/utils/jwt.js';
import type { SupportRepository } from '../repositories/support.repository.js';
import type { SupportTicket } from '../types/support.js';

class MockSupportRepository implements SupportRepository {
  createTicket = vi.fn().mockImplementation(
    async (userId, role, input) =>
      ({
        id: '22222222-e29b-41d4-a716-446655440000',
        ticketNumber: 'TCK-8921',
        userId,
        role,
        category: input.category,
        subject: input.subject,
        message: input.message,
        status: 'OPEN',
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as SupportTicket,
  );

  listTickets = vi.fn().mockResolvedValue([
    {
      id: '22222222-e29b-41d4-a716-446655440000',
      ticketNumber: 'TCK-8921',
      category: 'payment',
      subject: 'Payout delayed',
      message: 'My weekly payout has not arrived yet.',
      status: 'OPEN',
    } as SupportTicket,
  ]);

  getTicketById = vi.fn().mockImplementation(
    async (userId, ticketId) =>
      ({
        id: ticketId,
        ticketNumber: 'TCK-8921',
        userId,
        role: 'driver',
        category: 'payment',
        subject: 'Payout delayed',
        message: 'My weekly payout has not arrived yet.',
        status: 'OPEN',
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as SupportTicket,
  );
}

describe('Support Ticket API', () => {
  const supportRepo = new MockSupportRepository();
  const app = createApp(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    supportRepo,
  );

  const userId = '770e8400-e29b-41d4-a716-446655440000';

  it('creates a new support ticket', async () => {
    const token = await signAccessToken({ sub: userId, role: 'driver', type: 'access' });
    const res = await request(app)
      .post('/support/tickets')
      .set('authorization', `Bearer ${token}`)
      .send({
        category: 'vehicle',
        subject: 'Vehicle document query',
        message: 'How long does insurance verification take?',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ticketNumber).toBe('TCK-8921');
  });

  it('lists user support tickets', async () => {
    const token = await signAccessToken({ sub: userId, role: 'driver', type: 'access' });
    const res = await request(app).get('/support/tickets').set('authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(1);
  });
});
