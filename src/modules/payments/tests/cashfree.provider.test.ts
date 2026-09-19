import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashfreePaymentProvider } from '../providers/cashfree.provider.js';
import crypto from 'node:crypto';

describe('CashfreePaymentProvider', () => {
  const mockClientId = 'TEST_CF_CLIENT_ID_12345';
  const mockClientSecret = 'TEST_CF_CLIENT_SECRET_67890_SECRET';
  const mockBaseUrl = 'https://sandbox.cashfree.com/pg';
  const mockApiVersion = '2023-08-01';

  let provider: CashfreePaymentProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new CashfreePaymentProvider({
      clientId: mockClientId,
      clientSecret: mockClientSecret,
      baseUrl: mockBaseUrl,
      apiVersion: mockApiVersion,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Initialization & Configuration', () => {
    it('throws error when clientId or clientSecret is missing', () => {
      expect(() => new CashfreePaymentProvider({ clientId: '', clientSecret: 'sec' })).toThrow(
        'Cashfree clientId and clientSecret are required',
      );
      expect(() => new CashfreePaymentProvider({ clientId: 'id', clientSecret: '' })).toThrow(
        'Cashfree clientId and clientSecret are required',
      );
    });

    it('has correct providerName and default config', () => {
      const defaultProvider = new CashfreePaymentProvider({
        clientId: 'test-id',
        clientSecret: 'test-secret',
      });
      expect(defaultProvider.providerName).toBe('cashfree');
    });
  });

  describe('createOrder()', () => {
    it('sends correct headers, payload, and parses Cashfree response', async () => {
      const mockResponseData = {
        cf_order_id: 'cf_11223344',
        order_id: 'order_infurnus_123',
        entity: 'order',
        order_currency: 'INR',
        order_amount: 450.5,
        order_status: 'ACTIVE',
        payment_session_id: 'session_abcdef123456',
      };

      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      global.fetch = vi.fn().mockImplementation((url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponseData),
        } as Response);
      });

      const result = await provider.createOrder({
        orderId: 'order_infurnus_123',
        amount: 450.5,
        currency: 'INR',
        customerId: 'user-uuid-1',
        customerPhone: '+91 98765 43210',
        customerEmail: 'customer@example.com',
        customerName: 'Aarav Sharma',
        orderNote: 'Infurnus Sedan Ride',
      });

      expect(capturedUrl).toBe('https://sandbox.cashfree.com/pg/orders');
      expect(capturedInit?.method).toBe('POST');

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers['x-client-id']).toBe(mockClientId);
      expect(headers['x-client-secret']).toBe(mockClientSecret);
      expect(headers['x-api-version']).toBe(mockApiVersion);
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(capturedInit?.body as string);
      expect(body.order_id).toBe('order_infurnus_123');
      expect(body.order_amount).toBe(450.5);
      expect(body.order_currency).toBe('INR');
      expect(body.customer_details.customer_id).toBe('user-uuid-1');
      expect(body.customer_details.customer_phone).toBe('9876543210');
      expect(body.customer_details.customer_email).toBe('customer@example.com');
      expect(body.order_note).toBe('Infurnus Sedan Ride');

      expect(result).toEqual({
        providerOrderId: 'order_infurnus_123',
        paymentSessionId: 'session_abcdef123456',
        orderStatus: 'ACTIVE',
        entity: 'order',
        orderAmount: 450.5,
        orderCurrency: 'INR',
      });
    });

    it('sanitizes and masks secrets when Cashfree returns an error with sensitive details', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            message: `Authentication failed for ${mockClientSecret} with key ${mockClientId}`,
          }),
      } as Response);

      await expect(
        provider.createOrder({
          orderId: 'order_test_fail',
          amount: 100,
          currency: 'INR',
          customerId: 'cust_1',
        }),
      ).rejects.toThrowError();

      try {
        await provider.createOrder({
          orderId: 'order_test_fail',
          amount: 100,
          currency: 'INR',
          customerId: 'cust_1',
        });
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.message).not.toContain(mockClientSecret);
        expect(error.message).not.toContain(mockClientId);
        expect(error.message).toContain('[REDACTED_SECRET]');
        expect(error.message).toContain('[REDACTED_CLIENT_ID]');
      }
    });
  });

  describe('getPaymentStatus()', () => {
    it('fetches order status and queries payments list when PAID to get providerPaymentId', async () => {
      const mockOrderData = {
        order_id: 'order_infurnus_123',
        order_status: 'PAID',
        order_amount: 500,
        order_currency: 'INR',
      };

      const mockPaymentsData = [
        {
          cf_payment_id: 'cf_pay_998877',
          payment_status: 'SUCCESS',
          payment_amount: 500,
          payment_completion_time: '2026-03-01T12:30:00Z',
        },
      ];

      global.fetch = vi.fn().mockImplementation((url) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/payments')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockPaymentsData),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockOrderData),
        } as Response);
      });

      const statusResult = await provider.getPaymentStatus('order_infurnus_123');

      expect(statusResult.orderStatus).toBe('PAID');
      expect(statusResult.providerOrderId).toBe('order_infurnus_123');
      expect(statusResult.providerPaymentId).toBe('cf_pay_998877');
      expect(statusResult.paymentTime).toEqual(new Date('2026-03-01T12:30:00Z'));
      expect(statusResult.orderAmount).toBe(500);
    });

    it('normalizes ACTIVE, EXPIRED, TERMINATED, and unknown statuses accurately', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            order_id: 'order_active_1',
            order_status: 'ACTIVE',
            order_amount: 250,
            order_currency: 'INR',
          }),
      } as Response);

      const statusResult = await provider.getPaymentStatus('order_active_1');
      expect(statusResult.orderStatus).toBe('ACTIVE');
      expect(statusResult.providerPaymentId).toBeNull();
    });

    it('masks secrets on network or gateway error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: `Order not found with secret ${mockClientSecret}` }),
      } as Response);

      try {
        await provider.getPaymentStatus('order_non_existent');
      } catch (err) {
        const error = err as Error;
        expect(error.message).not.toContain(mockClientSecret);
        expect(error.message).toContain('[REDACTED_SECRET]');
      }
    });
  });

  describe('verifyWebhookSignature()', () => {
    it('verifies valid HMAC-SHA256 signature and rejects tampered payload', () => {
      const payload = JSON.stringify({
        data: { order: { order_id: 'order_123' }, payment: { payment_status: 'SUCCESS' } },
        event_time: '2026-03-01T12:00:00Z',
      });
      const timestamp = '1772366400';

      const validSignature = crypto
        .createHmac('sha256', mockClientSecret)
        .update(timestamp + payload)
        .digest('base64');

      const isValid = provider.verifyWebhookSignature(payload, validSignature, timestamp);
      expect(isValid).toBe(true);

      const isInvalid = provider.verifyWebhookSignature(payload, 'tampered_signature', timestamp);
      expect(isInvalid).toBe(false);

      const isTamperedPayload = provider.verifyWebhookSignature(
        payload + 'tamper',
        validSignature,
        timestamp,
      );
      expect(isTamperedPayload).toBe(false);
    });
  });

  describe('refundPayment()', () => {
    it('sends correct refund request and returns refund result', async () => {
      const mockRefundResponse = {
        cf_refund_id: 'cf_ref_111',
        refund_id: 'ref_infurnus_1',
        refund_status: 'SUCCESS',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockRefundResponse),
      } as Response);

      const refundResult = await provider.refundPayment({
        providerOrderId: 'order_123',
        refundAmount: 200,
        refundId: 'ref_infurnus_1',
        note: 'Customer cancellation refund',
      });

      expect(refundResult.refundId).toBe('ref_infurnus_1');
      expect(refundResult.status).toBe('SUCCESS');
    });
  });
});
