import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../../auth/utils/jwt.js';
import { createSupportRouter } from '../routes/support.routes.js';
import { SupportController } from '../controllers/support.controller.js';
import type { SupportRepository } from '../repositories/support.repository.js';
import { SupportService } from '../services/support.service.js';
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
  const app = express();
  app.use(express.json());
  app.use('/support', createSupportRouter(new SupportController(new SupportService(supportRepo))));

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

  it('allows an authenticated customer to open support', async () => {
    const token = await signAccessToken({ sub: userId, role: 'customer', type: 'access' });
    const res = await request(app)
      .post('/support/tickets')
      .set('authorization', `Bearer ${token}`)
      .send({
        category: 'account',
        subject: 'Ride booking help',
        message: 'I need help with a recent booking.',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(supportRepo.createTicket).toHaveBeenLastCalledWith(
      userId,
      'customer',
      expect.objectContaining({ subject: 'Ride booking help' }),
    );
  });

  it('lists user support tickets', async () => {
    const token = await signAccessToken({ sub: userId, role: 'driver', type: 'access' });
    const res = await request(app).get('/support/tickets').set('authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(1);
  });
});
