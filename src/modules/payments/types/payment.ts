export type PaymentStatus = 'INITIATED' | 'AUTHORIZED' | 'CAPTURED' | 'REFUNDED' | 'FAILED';

export interface Payment {
  id: string;
  userId: string;
  rideId: string | null;
  rentalId: string | null;
  logisticsOrderId: string | null;
  status: PaymentStatus;
  amount: number;
  currency: string;
  provider: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  idempotencyKey: string | null;
  initiatedAt: Date;
  authorizedAt: Date | null;
  capturedAt: Date | null;
  refundedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InitiatePaymentData {
  userId: string;
  rideId?: string | undefined;
  rentalId?: string | undefined;
  logisticsOrderId?: string | undefined;
  amount: number;
  currency?: string | undefined;
  provider?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface CapturePaymentData {
  paymentId: string;
  providerPaymentId?: string | undefined;
}
