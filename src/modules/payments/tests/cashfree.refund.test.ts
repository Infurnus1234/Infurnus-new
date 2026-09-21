import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { Payment } from '../types/payment.js';
import type { PaymentProvider } from '../providers/payment.provider.js';

describe('Payment Refund Lifecycle & Authorization', () => {
  const customerId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  const adminId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66';
  const providerOrderId = 'order_pay-uuid-created';

  const mockCapturedPayment: Payment = {
    id: 'pay-uuid-created',
    userId: customerId,
    rideId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    rentalId: null,
    logisticsOrderId: null,
    status: 'CAPTURED',
    amount: 500.0,
    currency: 'INR',
    provider: 'cashfree',
    providerOrderId,
    providerPaymentId: 'cf_pay_12345',
    idempotencyKey: null,
    initiatedAt: new Date('2026-03-01T10:00:00.000Z'),
    authorizedAt: new Date('2026-03-01T10:00:30.000Z'),
    capturedAt: new Date('2026-03-01T10:01:00.000Z'),
    refundedAt: null,
    failedAt: null,
    failureReason: null,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:01:00.000Z'),
  };

  let mockRepo: PaymentRepository;
  let mockProvider: PaymentProvider;
  let controller: PaymentController;

  const mockResponse = () => {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res as Response & {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
    };
  };

  const mockAdminRequest = (body: Record<string, unknown>): Request =>
    ({
      auth: { userId: adminId, role: 'admin' },
      params: { paymentId: mockCapturedPayment.id },
      body,
    }) as unknown as Request;

  beforeEach(() => {
    mockRepo = {
      initiate: vi.fn(),
      capture: vi.fn(),
      findById: vi.fn().mockResolvedValue(mockCapturedPayment),
      findByRideId: vi.fn().mockResolvedValue([mockCapturedPayment]),
      findActiveByRideId: vi.fn().mockResolvedValue(mockCapturedPayment),
      listForUser: vi.fn().mockResolvedValue([mockCapturedPayment]),
      refund: vi.fn().mockImplementation((id, _amount, reason) =>
        Promise.resolve({
          ...mockCapturedPayment,
          id,
          status: 'REFUNDED',
          refundedAt: new Date(),
          failureReason: reason ?? null,
        }),
      ),
    };

    mockProvider = {
      providerName: 'cashfree',
      createOrder: vi.fn(),
      getPaymentStatus: vi.fn(),
      refundPayment: vi.fn().mockResolvedValue({
        refundId: 'cf_ref_12345',
        status: 'SUCCESS',
      }),
    };

    controller = new PaymentController(mockRepo, undefined, undefined, mockProvider);
  });

  describe('Authorization & Validation', () => {
    it('rejects refund request when user is not an admin', async () => {
      const req = {
        auth: { userId: customerId, role: 'customer' },
        params: { paymentId: mockCapturedPayment.id },
        body: { amount: 200, reason: 'Customer cancellation' },
      } as unknown as Request;
      const res = mockResponse();

      await controller.refund(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Only administrators') }),
      );
      expect(mockRepo.refund).not.toHaveBeenCalled();
    });

    it('rejects refund if payment does not exist', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce(null);

      const req = mockAdminRequest({ amount: 100 });
      const res = mockResponse();

      await controller.refund(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Payment not found' }),
      );
    });

    it('rejects refund if payment is in INITIATED state', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce({
        ...mockCapturedPayment,
        status: 'INITIATED',
      });

      const req = mockAdminRequest({ amount: 100 });
      const res = mockResponse();

      await controller.refund(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Cannot refund payment in INITIATED state' }),
      );
    });

    it('rejects duplicate refund if payment is already REFUNDED', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValueOnce({
        ...mockCapturedPayment,
        status: 'REFUNDED',
      });

      const req = mockAdminRequest({ amount: 100 });
      const res = mockResponse();

      await controller.refund(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Payment has already been refunded' }),
      );
    });

    it('rejects refund if requested amount exceeds captured amount', async () => {
      const req = mockAdminRequest({ amount: 600, reason: 'Excessive refund' }); // payment is 500
      const res = mockResponse();

      await controller.refund(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('cannot exceed payment amount'),
        }),
      );
      expect(mockRepo.refund).not.toHaveBeenCalled();
    });
  });

  describe('Execution & Gateway Integration', () => {
    it('successfully processes full refund through Cashfree and updates repository', async () => {
      const req = mockAdminRequest({ amount: 500, reason: 'Trip cancelled by partner' });
      const res = mockResponse();

      await controller.refund(req, res, vi.fn());

      expect(mockProvider.refundPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOrderId,
          refundAmount: 500,
          note: 'Trip cancelled by partner',
        }),
      );

      expect(mockRepo.refund).toHaveBeenCalledWith(
        mockCapturedPayment.id,
        500,
        'Trip cancelled by partner',
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ status: 'REFUNDED' }),
        message: 'Payment refunded successfully',
      });
    });

    it('returns 502 if Cashfree refund fails', async () => {
      vi.mocked(mockProvider.refundPayment!).mockRejectedValueOnce(
        new Error('Cashfree refund failed with status 400: Refund already in progress'),
      );

      const req = mockAdminRequest({ amount: 250, reason: 'Partial refund' });
      const res = mockResponse();

      await controller.refund(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('Refund already in progress'),
      });
      expect(mockRepo.refund).not.toHaveBeenCalled();
    });
  });
});
