import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'cashfree_checkout_service.dart';
import 'upi_payment_service.dart';

enum PaymentGatewayStatus {
  success,
  pending,
  cancelled,
  failed,
}

class PaymentGatewayCheckoutResult {
  final PaymentGatewayStatus status;
  final String orderId;
  final String? referenceId;
  final String? paymentSessionId;
  final String? errorMessage;
  final Map<String, dynamic>? rawResponse;

  const PaymentGatewayCheckoutResult({
    required this.status,
    required this.orderId,
    this.referenceId,
    this.paymentSessionId,
    this.errorMessage,
    this.rawResponse,
  });
}

/// Abstract contract for payment gateway checkouts.
abstract class PaymentGateway {
  Future<PaymentGatewayCheckoutResult> startCheckout({
    required String orderId,
    required double amount,
    required String currency,
    String? paymentSessionId,
    Map<String, dynamic>? extraData,
  });
}

/// Cashfree PG implementation
class CashfreePaymentGateway implements PaymentGateway {
  final CashfreeCheckoutService _cashfreeService;

  CashfreePaymentGateway(this._cashfreeService);

  @override
  Future<PaymentGatewayCheckoutResult> startCheckout({
    required String orderId,
    required double amount,
    required String currency,
    String? paymentSessionId,
    Map<String, dynamic>? extraData,
  }) async {
    if (paymentSessionId == null || paymentSessionId.isEmpty) {
      return PaymentGatewayCheckoutResult(
        status: PaymentGatewayStatus.failed,
        orderId: orderId,
        errorMessage: 'Payment session ID required for Cashfree checkout',
      );
    }

    final res = await _cashfreeService.startCheckout(
      orderId: orderId,
      paymentSessionId: paymentSessionId,
    );

    switch (res.status) {
      case CashfreeCheckoutStatus.success:
        return PaymentGatewayCheckoutResult(
          status: PaymentGatewayStatus.success,
          orderId: orderId,
          referenceId: res.referenceId,
        );
      case CashfreeCheckoutStatus.pending:
        return PaymentGatewayCheckoutResult(
          status: PaymentGatewayStatus.pending,
          orderId: orderId,
          referenceId: res.referenceId,
        );
      case CashfreeCheckoutStatus.cancelled:
        return PaymentGatewayCheckoutResult(
          status: PaymentGatewayStatus.cancelled,
          orderId: orderId,
          errorMessage: 'Checkout cancelled by user',
        );
      case CashfreeCheckoutStatus.failed:
        return PaymentGatewayCheckoutResult(
          status: PaymentGatewayStatus.failed,
          orderId: orderId,
          errorMessage: res.errorMessage ?? 'Payment failed at gateway',
        );
    }
  }
}

/// Direct UPI App Intent implementation (PhonePe, Google Pay, Paytm)
class UpiIntentPaymentGateway implements PaymentGateway {
  final UpiPaymentService _upiService;

  UpiIntentPaymentGateway(this._upiService);

  @override
  Future<PaymentGatewayCheckoutResult> startCheckout({
    required String orderId,
    required double amount,
    required String currency,
    String? paymentSessionId,
    Map<String, dynamic>? extraData,
  }) async {
    final upiApp = extraData?['app'] as UpiPaymentApp? ?? UpiPaymentApp.any;
    final res = await _upiService.pay(
      merchantVpa: 'infurnus@ybl',
      merchantName: 'INFURNUS Wallet',
      amount: amount,
      transactionId: orderId,
      app: upiApp,
    );

    if (res.success) {
      return PaymentGatewayCheckoutResult(
        status: PaymentGatewayStatus.success,
        orderId: orderId,
        referenceId: res.transactionId,
      );
    } else {
      return PaymentGatewayCheckoutResult(
        status: PaymentGatewayStatus.failed,
        orderId: orderId,
        errorMessage: res.errorMessage ?? 'UPI payment could not be opened',
      );
    }
  }
}

final cashfreePaymentGatewayProvider = Provider<PaymentGateway>((ref) {
  return CashfreePaymentGateway(ref.read(cashfreeCheckoutServiceProvider));
});

final upiPaymentGatewayProvider = Provider<PaymentGateway>((ref) {
  return UpiIntentPaymentGateway(ref.read(upiPaymentServiceProvider));
});

/// Default payment gateway provider (defaults to Cashfree)
final paymentGatewayProvider = Provider<PaymentGateway>((ref) {
  return ref.read(cashfreePaymentGatewayProvider);
});
