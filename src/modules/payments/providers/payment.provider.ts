export interface CreateOrderParams {
  orderId: string;
  amount: number;
  currency: string;
  customerId: string;
  customerPhone?: string | undefined;
  customerEmail?: string | undefined;
  customerName?: string | undefined;
  orderNote?: string | undefined;
  returnUrl?: string | undefined;
}

export interface CreateOrderResult {
  providerOrderId: string;
  paymentSessionId?: string | null;
  orderStatus: string;
  entity: string;
  orderAmount: number;
  orderCurrency: string;
}

export interface PaymentStatusResult {
  providerOrderId: string;
  orderStatus: 'PAID' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED' | 'FAILED' | 'UNKNOWN';
  orderAmount: number;
  orderCurrency: string;
  providerPaymentId?: string | null;
  paymentTime?: Date | null;
  rawStatus?: string;
}

export interface RefundParams {
  providerOrderId: string;
  refundAmount: number;
  refundId: string;
  note?: string | undefined;
}

export interface RefundResult {
  refundId: string;
  status: string;
}

export interface PaymentProvider {
  readonly providerName: string;

  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;

  getPaymentStatus(providerOrderId: string): Promise<PaymentStatusResult>;

  verifyWebhookSignature?(payload: string, signature: string, timestamp?: string): boolean;

  refundPayment?(params: RefundParams): Promise<RefundResult>;
}
