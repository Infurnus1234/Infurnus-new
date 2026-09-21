import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';
import type { PaymentRepository } from '../repositories/payment.repository.js';
import type { Payment } from '../types/payment.js';
import type { PaymentProvider } from '../providers/payment.provider.js';

describe('Cashfree Webhook Handling & Reconciliation', () => {
  const customerId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
  const rideId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
  const providerOrderId = 'order_pay-uuid-created';

  const mockPayment: Payment = {
    id: 'pay-uuid-created',
    userId: customerId,
    rideId,
    rentalId: null,
    logisticsOrderId: null,
    status: 'INITIATED',
    amount: 350.0,
    currency: 'INR',
    provider: 'cashfree',
    providerOrderId,
    providerPaymentId: null,
    idempotencyKey: 'idemp-key-1',
    initiatedAt: new Date('2026-03-01T10:00:00.000Z'),
    authorizedAt: null,
    capturedAt: null,
    refundedAt: null,
    failedAt: null,
    failureReason: null,
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T10:00:00.000Z'),
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

  const mockWebhookRequest = (
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Request =>
    ({
      body,
      headers: {
        'x-webhook-signature': 'valid_mock_signature',
        'x-webhook-timestamp': '1772366400',
        ...headers,
      },
      rawBody: JSON.stringify(body),
    }) as unknown as Request;

  beforeEach(() => {
    let currentPaymentState = { ...mockPayment };

    mockRepo = {
      initiate: vi.fn(),
      capture: vi.fn().mockImplementation((data) => {
        currentPaymentState = {
          ...currentPaymentState,
          status: 'CAPTURED',
          capturedAt: new Date(),
          providerPaymentId: data.providerPaymentId ?? 'cf_pay_default',
        };
        return Promise.resolve(currentPaymentState);
      }),
      findById: vi
        .fn()
        .mockImplementation((id) =>
          id === mockPayment.id ? Promise.resolve(currentPaymentState) : Promise.resolve(null),
        ),
      findByProviderOrderId: vi
        .fn()
        .mockImplementation((orderId) =>
          orderId === providerOrderId
            ? Promise.resolve(currentPaymentState)
            : Promise.resolve(null),
        ),
      markFailed: vi.fn().mockImplementation((id, reason) => {
        currentPaymentState = {
          ...currentPaymentState,
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: reason,
        };
        return Promise.resolve(currentPaymentState);
      }),
      findByRideId: vi.fn().mockResolvedValue([mockPayment]),
      findActiveByRideId: vi.fn().mockResolvedValue(mockPayment),
      listForUser: vi.fn().mockResolvedValue([mockPayment]),
      updateProviderOrder: vi.fn().mockResolvedValue(mockPayment),
    };

    mockProvider = {
      providerName: 'cashfree',
      createOrder: vi.fn(),
      getPaymentStatus: vi.fn().mockResolvedValue({
        providerOrderId,
        orderStatus: 'PAID',
        orderAmount: 350.0,
        orderCurrency: 'INR',
        providerPaymentId: 'cf_pay_998877',
      }),
      verifyWebhookSignature: vi
        .fn()
        .mockImplementation((_raw, sig) => sig === 'valid_mock_signature'),
    };

    controller = new PaymentController(mockRepo, undefined, undefined, mockProvider);
  });

  describe('Signature Verification', () => {
    it('rejects webhook when signature header is missing', async () => {
      const req = {
        body: { type: 'PAYMENT_SUCCESS_WEBHOOK' },
        headers: {},
      } as unknown as Request;
      const res = mockResponse();

      await controller.handleCashfreeWebhook(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Missing webhook signature' }),
      );
    });

    it('rejects webhook when signature is invalid', async () => {
      const req = mockWebhookRequest(
        { type: 'PAYMENT_SUCCESS_WEBHOOK' },
        { 'x-webhook-signature': 'invalid_signature' },
      );
      const res = mockResponse();

      await controller.handleCashfreeWebhook(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Invalid webhook signature' }),
      );
    });
  });

  describe('Payload Parsing & Event Processing', () => {
    it('returns 400 when order_id is missing in payload', async () => {
      const req = mockWebhookRequest({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {},
      });
      const res = mockResponse();

      await controller.handleCashfreeWebhook(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Missing order_id in webhook payload' }),
      );
    });

    it('handles unknown order safely without creating unauthorized payment records', async () => {
      const req = mockWebhookRequest({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: { order_id: 'unknown_order_999' },
          payment: { payment_status: 'SUCCESS', payment_amount: 350 },
        },
      });
      const res = mockResponse();

      await controller.handleCashfreeWebhook(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Payment record not found for webhook order, ignored safely',
        }),
      );
      expect(mockRepo.capture).not.toHaveBeenCalled();
    });

    it('successfully processes PAYMENT_SUCCESS_WEBHOOK and captures payment', async () => {
      const req = mockWebhookRequest({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: { order_id: providerOrderId, order_amount: 350.0 },
          payment: {
            cf_payment_id: 'cf_pay_112233',
            payment_status: 'SUCCESS',
            payment_amount: 350.0,
          },
        },
      });
      const res = mockResponse();

      await controller.handleCashfreeWebhook(req, res, vi.fn());

      expect(mockRepo.capture).toHaveBeenCalledWith({
        paymentId: mockPayment.id,
        providerPaymentId: 'cf_pay_112233',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Payment captured successfully via webhook',
        }),
      );
    });

    it('rejects capture if webhook payment amount does not match authoritative payment amount', async () => {
      const req = mockWebhookRequest({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: { order_id: providerOrderId },
          payment: {
            cf_payment_id: 'cf_pay_tampered',
            payment_status: 'SUCCESS',
            payment_amount: 10.0, // expected 350.0
          },
        },
      });
      const res = mockResponse();

      await controller.handleCashfreeWebhook(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('Amount mismatch in webhook'),
        }),
      );
      expect(mockRepo.capture).not.toHaveBeenCalled();
    });

    it('processes PAYMENT_FAILED_WEBHOOK and marks payment failed', async () => {
      const req = mockWebhookRequest({
        type: 'PAYMENT_FAILED_WEBHOOK',
        data: {
          order: { order_id: providerOrderId },
          payment: {
            payment_status: 'FAILED',
            payment_message: 'Insufficient balance',
          },
        },
      });
      const res = mockResponse();

      await controller.handleCashfreeWebhook(req, res, vi.fn());

      expect(mockRepo.markFailed).toHaveBeenCalledWith(mockPayment.id, 'Insufficient balance');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Payment marked failed via webhook',
        }),
      );
    });

    it('safely handles non-payment event like PAYMENT_USER_DROPPED_WEBHOOK', async () => {
      const req = mockWebhookRequest({
        type: 'PAYMENT_USER_DROPPED_WEBHOOK',
        data: {
          order: { order_id: providerOrderId },
        },
      });
      const res = mockResponse();

      await controller.handleCashfreeWebhook(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockRepo.capture).not.toHaveBeenCalled();
      expect(mockRepo.markFailed).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency & Race Conditions', () => {
    it('is idempotent when the same success webhook arrives multiple times', async () => {
      const req = mockWebhookRequest({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: { order_id: providerOrderId, order_amount: 350.0 },
          payment: {
            cf_payment_id: 'cf_pay_112233',
            payment_status: 'SUCCESS',
            payment_amount: 350.0,
          },
        },
      });

      // 1st delivery
      const res1 = mockResponse();
      await controller.handleCashfreeWebhook(req, res1, vi.fn());
      expect(mockRepo.capture).toHaveBeenCalledTimes(1);
      expect(res1.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Payment captured successfully via webhook' }),
      );

      // 2nd through 10th deliveries
      for (let i = 2; i <= 10; i++) {
        const resN = mockResponse();
        await controller.handleCashfreeWebhook(req, resN, vi.fn());
        expect(resN.json).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'Payment already captured' }),
        );
      }

      // Repository capture called only once
      expect(mockRepo.capture).toHaveBeenCalledTimes(1);
    });

    it('handles race condition: Webhook arrives first, then Frontend callback arrives', async () => {
      const webhookReq = mockWebhookRequest({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: { order_id: providerOrderId, order_amount: 350.0 },
          payment: {
            cf_payment_id: 'cf_pay_112233',
            payment_status: 'SUCCESS',
            payment_amount: 350.0,
          },
        },
      });
      const webhookRes = mockResponse();

      // 1. Webhook arrives and captures
      await controller.handleCashfreeWebhook(webhookReq, webhookRes, vi.fn());
      expect(mockRepo.capture).toHaveBeenCalledTimes(1);

      // 2. Frontend callback calls capture later
      const callbackReq = {
        params: { paymentId: mockPayment.id },
        auth: { userId: customerId, role: 'customer' },
        body: { providerPaymentId: 'cf_pay_112233' },
      } as unknown as Request;
      const callbackRes = mockResponse();

      await controller.capture(callbackReq, callbackRes, vi.fn());

      // Callback returns existing captured record cleanly
      expect(callbackRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Payment captured successfully',
        }),
      );
      // No duplicate capture in repo
      expect(mockRepo.capture).toHaveBeenCalledTimes(1);
    });

    it('handles race condition: Frontend callback arrives first, then Webhook arrives', async () => {
      // 1. Frontend callback calls capture
      const callbackReq = {
        params: { paymentId: mockPayment.id },
        auth: { userId: customerId, role: 'customer' },
        body: {},
      } as unknown as Request;
      const callbackRes = mockResponse();

      await controller.capture(callbackReq, callbackRes, vi.fn());
      expect(mockRepo.capture).toHaveBeenCalledTimes(1);

      // 2. Webhook arrives later
      const webhookReq = mockWebhookRequest({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: { order_id: providerOrderId, order_amount: 350.0 },
          payment: {
            cf_payment_id: 'cf_pay_112233',
            payment_status: 'SUCCESS',
            payment_amount: 350.0,
          },
        },
      });
      const webhookRes = mockResponse();

      await controller.handleCashfreeWebhook(webhookReq, webhookRes, vi.fn());

      expect(webhookRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Payment already captured' }),
      );
      expect(mockRepo.capture).toHaveBeenCalledTimes(1);
    });
  });
});
