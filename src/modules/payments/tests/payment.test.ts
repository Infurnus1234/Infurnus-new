import { describe, expect, it, vi } from 'vitest';
import { PaymentController } from '../controllers/payment.controller.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { Payment } from '../types/payment.js';

describe('INFURNUS Payments Module', () => {
  const mockPayment: Payment = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    userId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    rideId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    rentalId: null,
    logisticsOrderId: null,
    status: 'INITIATED',
    amount: 350.0,
    currency: 'INR',
    provider: 'wallet',
    providerOrderId: null,
    providerPaymentId: null,
    idempotencyKey: null,
    initiatedAt: new Date('2026-03-01T10:00:00.000Z'),
    authorizedAt: null,
    capturedAt: null,
    refundedAt: null,
    failedAt: null,
    failureReason: null,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:00:00.000Z'),
  };

  const mockCaptured: Payment = {
    ...mockPayment,
    status: 'CAPTURED',
    capturedAt: new Date('2026-03-01T10:01:00.000Z'),
    providerPaymentId: 'pay_test_12345',
  };

  const mockRepo: PaymentRepository = {
    initiate: vi.fn().mockResolvedValue(mockPayment),
    capture: vi.fn().mockResolvedValue(mockCaptured),
    findById: vi.fn().mockResolvedValue(mockPayment),
    findByRideId: vi.fn().mockResolvedValue([mockPayment]),
    listForUser: vi.fn().mockResolvedValue([mockPayment]),
  };

  const controller = new PaymentController(mockRepo);

  it('initiates a ride payment successfully', async () => {
    const req: any = {
      auth: { userId: mockPayment.userId },
      body: {
        rideId: mockPayment.rideId,
        amount: 350.0,
        provider: 'wallet',
      },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await controller.initiate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: mockPayment,
      message: 'Payment initiated successfully',
    });
  });

  it('captures a payment successfully', async () => {
    const req: any = {
      params: { paymentId: mockPayment.id },
      body: { providerPaymentId: 'pay_test_12345' },
    };
    const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    const next = vi.fn();

    await controller.capture(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: mockCaptured,
      message: 'Payment captured successfully',
    });
  });

  it('lists user payment transaction history', async () => {
    const req: any = { auth: { userId: mockPayment.userId } };
    const res: any = { json: vi.fn() };
    const next = vi.fn();

    await controller.listHistory(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [mockPayment],
    });
  });
});
