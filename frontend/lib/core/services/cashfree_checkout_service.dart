import 'dart:async';
import 'package:flutter_cashfree_pg_sdk/api/cferrorresponse/cferrorresponse.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpayment/cfdropcheckoutpayment.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfpaymentgateway/cfpaymentgatewayservice.dart';
import 'package:flutter_cashfree_pg_sdk/api/cfsession/cfsession.dart';
import 'package:flutter_cashfree_pg_sdk/utils/cfenums.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum CashfreeCheckoutStatus {
  success,
  failed,
  cancelled,
}

class CashfreeCheckoutResult {
  final CashfreeCheckoutStatus status;
  final String orderId;
  final String? referenceId;
  final String? errorMessage;

  const CashfreeCheckoutResult({
    required this.status,
    required this.orderId,
    this.referenceId,
    this.errorMessage,
  });

  bool get isSuccess => status == CashfreeCheckoutStatus.success;
}

abstract class CashfreeCheckoutService {
  Future<CashfreeCheckoutResult> startCheckout({
    required String orderId,
    required String paymentSessionId,
    bool isSandbox = true,
  });
}

class CashfreePgCheckoutService implements CashfreeCheckoutService {
  final CFPaymentGatewayService _gatewayService;

  CashfreePgCheckoutService([CFPaymentGatewayService? gatewayService])
      : _gatewayService = gatewayService ?? CFPaymentGatewayService();

  @override
  Future<CashfreeCheckoutResult> startCheckout({
    required String orderId,
    required String paymentSessionId,
    bool isSandbox = true,
  }) async {
    final completer = Completer<CashfreeCheckoutResult>();

    try {
      _gatewayService.setCallback(
        (String completedOrderId) {
          if (!completer.isCompleted) {
            completer.complete(CashfreeCheckoutResult(
              status: CashfreeCheckoutStatus.success,
              orderId: completedOrderId,
            ));
          }
        },
        (CFErrorResponse errorResponse, String failedOrderId) {
          if (!completer.isCompleted) {
            final isUserCancelled = errorResponse.getStatus()?.toUpperCase() == 'CANCELLED' ||
                (errorResponse.getMessage()?.toLowerCase().contains('cancel') ?? false);

            completer.complete(CashfreeCheckoutResult(
              status: isUserCancelled
                  ? CashfreeCheckoutStatus.cancelled
                  : CashfreeCheckoutStatus.failed,
              orderId: failedOrderId,
              referenceId: errorResponse.getCode(),
              errorMessage: errorResponse.getMessage() ?? 'Payment was cancelled or failed',
            ));
          }
        },
      );

      final session = CFSessionBuilder()
          .setEnvironment(isSandbox ? CFEnvironment.SANDBOX : CFEnvironment.PRODUCTION)
          .setOrderId(orderId)
          .setPaymentSessionId(paymentSessionId)
          .build();

      final dropCheckout = CFDropCheckoutPaymentBuilder()
          .setSession(session)
          .build();

      await _gatewayService.doPayment(dropCheckout);
    } catch (e) {
      if (!completer.isCompleted) {
        completer.complete(CashfreeCheckoutResult(
          status: CashfreeCheckoutStatus.failed,
          orderId: orderId,
          errorMessage: e.toString(),
        ));
      }
    }

    return completer.future;
  }
}

final cashfreeCheckoutServiceProvider = Provider<CashfreeCheckoutService>((ref) {
  return CashfreePgCheckoutService();
});
