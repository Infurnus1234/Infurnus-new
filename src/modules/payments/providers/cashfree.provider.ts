import crypto from 'node:crypto';
import type {
  CreateOrderParams,
  CreateOrderResult,
  PaymentProvider,
  PaymentStatusResult,
  RefundParams,
  RefundResult,
} from './payment.provider.js';

export interface CashfreeConfig {
  clientId: string;
  clientSecret: string;
  apiVersion?: string;
  baseUrl?: string;
}

export class CashfreePaymentProvider implements PaymentProvider {
  readonly providerName = 'cashfree';
  private readonly baseUrl: string;
  private readonly apiVersion: string;

  constructor(private readonly config: CashfreeConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('Cashfree clientId and clientSecret are required');
    }

    this.baseUrl = (config.baseUrl ?? 'https://sandbox.cashfree.com/pg').replace(/\/+$/, '');
    this.apiVersion = config.apiVersion ?? '2023-08-01';
  }

  private getHeaders(): Record<string, string> {
    return {
      'x-client-id': this.config.clientId,
      'x-client-secret': this.config.clientSecret,
      'x-api-version': this.apiVersion,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private sanitizeError(error: unknown): Error {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const sanitized = rawMessage
      .replace(new RegExp(this.config.clientSecret, 'g'), '[REDACTED_SECRET]')
      .replace(new RegExp(this.config.clientId, 'g'), '[REDACTED_CLIENT_ID]');
    return new Error(sanitized);
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    try {
      const sanitizedPhone = params.customerPhone
        ? params.customerPhone.replace(/\D/g, '').slice(-10)
        : '9999999999';

      const requestBody = {
        order_id: params.orderId,
        order_amount: Math.round(params.amount * 100) / 100,
        order_currency: params.currency || 'INR',
        customer_details: {
          customer_id: params.customerId,
          customer_phone: sanitizedPhone.length === 10 ? sanitizedPhone : '9999999999',
          ...(params.customerEmail ? { customer_email: params.customerEmail } : {}),
          ...(params.customerName ? { customer_name: params.customerName } : {}),
        },
        ...(params.orderNote ? { order_note: params.orderNote } : {}),
        ...(params.returnUrl ? { order_meta: { return_url: params.returnUrl } } : {}),
      };

      const response = await fetch(`${this.baseUrl}/orders`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let gatewayMessage = `Cashfree order creation failed with status ${response.status}`;
        try {
          const errData = (await response.json()) as { message?: string; code?: string };
          if (errData.message) {
            gatewayMessage = errData.message;
          }
        } catch {
          // ignore json parse failure on non-200 responses
        }
        throw new Error(gatewayMessage);
      }

      const data = (await response.json()) as {
        cf_order_id?: string | number;
        order_id: string;
        entity?: string;
        order_currency: string;
        order_amount: number;
        order_status: string;
        payment_session_id?: string;
      };

      return {
        providerOrderId: data.order_id,
        paymentSessionId: data.payment_session_id ?? null,
        orderStatus: data.order_status,
        entity: data.entity ?? 'order',
        orderAmount: Number(data.order_amount),
        orderCurrency: data.order_currency,
      };
    } catch (err) {
      throw this.sanitizeError(err);
    }
  }

  async getPaymentStatus(providerOrderId: string): Promise<PaymentStatusResult> {
    try {
      const response = await fetch(`${this.baseUrl}/orders/${encodeURIComponent(providerOrderId)}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        let gatewayMessage = `Cashfree order fetch failed with status ${response.status}`;
        try {
          const errData = (await response.json()) as { message?: string };
          if (errData.message) {
            gatewayMessage = errData.message;
          }
        } catch {
          // ignore
        }
        throw new Error(gatewayMessage);
      }

      const orderData = (await response.json()) as {
        order_id: string;
        order_status: string;
        order_amount: number;
        order_currency: string;
      };

      let normalizedStatus: PaymentStatusResult['orderStatus'] = 'UNKNOWN';
      switch (orderData.order_status?.toUpperCase()) {
        case 'PAID':
          normalizedStatus = 'PAID';
          break;
        case 'ACTIVE':
          normalizedStatus = 'ACTIVE';
          break;
        case 'EXPIRED':
          normalizedStatus = 'EXPIRED';
          break;
        case 'TERMINATED':
          normalizedStatus = 'TERMINATED';
          break;
        case 'FAILED':
          normalizedStatus = 'FAILED';
          break;
        default:
          normalizedStatus = 'UNKNOWN';
      }

      let providerPaymentId: string | null = null;
      let paymentTime: Date | null = null;

      // If status is PAID, try to fetch payments list to get the specific payment ID and timestamp
      if (normalizedStatus === 'PAID') {
        try {
          const paymentsRes = await fetch(
            `${this.baseUrl}/orders/${encodeURIComponent(providerOrderId)}/payments`,
            {
              method: 'GET',
              headers: this.getHeaders(),
            },
          );

          if (paymentsRes.ok) {
            const payments = (await paymentsRes.json()) as Array<{
              cf_payment_id?: string | number;
              payment_status?: string;
              payment_completion_time?: string;
            }>;

            const successfulPayment = Array.isArray(payments)
              ? payments.find((p) => p.payment_status?.toUpperCase() === 'SUCCESS')
              : undefined;

            if (successfulPayment?.cf_payment_id) {
              providerPaymentId = String(successfulPayment.cf_payment_id);
            }
            if (successfulPayment?.payment_completion_time) {
              paymentTime = new Date(successfulPayment.payment_completion_time);
            }
          }
        } catch {
          // payments list fetch is non-fatal; status remains PAID
        }
      }

      return {
        providerOrderId: orderData.order_id,
        orderStatus: normalizedStatus,
        orderAmount: Number(orderData.order_amount),
        orderCurrency: orderData.order_currency,
        providerPaymentId,
        paymentTime,
        rawStatus: orderData.order_status,
      };
    } catch (err) {
      throw this.sanitizeError(err);
    }
  }

  verifyWebhookSignature(payload: string, signature: string, timestamp?: string): boolean {
    try {
      const dataToSign = timestamp ? `${timestamp}${payload}` : payload;
      const expectedSignature = crypto
        .createHmac('sha256', this.config.clientSecret)
        .update(dataToSign)
        .digest('base64');

      const expectedBuffer = Buffer.from(expectedSignature);
      const signatureBuffer = Buffer.from(signature);

      if (expectedBuffer.length !== signatureBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  }

  async refundPayment(params: RefundParams): Promise<RefundResult> {
    try {
      const response = await fetch(
        `${this.baseUrl}/orders/${encodeURIComponent(params.providerOrderId)}/refunds`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            refund_amount: params.refundAmount,
            refund_id: params.refundId,
            ...(params.note ? { refund_note: params.note } : {}),
          }),
        },
      );

      if (!response.ok) {
        let gatewayMessage = `Cashfree refund failed with status ${response.status}`;
        try {
          const errData = (await response.json()) as { message?: string };
          if (errData.message) gatewayMessage = errData.message;
        } catch {
          // ignore
        }
        throw new Error(gatewayMessage);
      }

      const data = (await response.json()) as {
        refund_id: string;
        refund_status?: string;
      };

      return {
        refundId: data.refund_id,
        status: data.refund_status ?? 'SUCCESS',
      };
    } catch (err) {
      throw this.sanitizeError(err);
    }
  }
}
