import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

/// Supported UPI apps for direct payment launch
enum UpiPaymentApp {
  phonePe,
  googlePay,
  paytm,
  any, // Let system/user pick available app
}

class UpiPaymentResult {
  final bool success;
  final String? transactionId;
  final String? errorMessage;
  final String rawStatus;

  const UpiPaymentResult({
    required this.success,
    required this.rawStatus,
    this.transactionId,
    this.errorMessage,
  });
}

class UpiPaymentService {
  /// Initiates a UPI payment to the merchant VPA via standard UPI intent or app-specific scheme.
  ///
  /// [merchantVpa]   — Merchant's UPI ID (e.g. infurnus@ybl)
  /// [merchantName]  — Display name shown in the UPI app
  /// [amount]        — Amount in INR (e.g. 250.00)
  /// [transactionId] — Unique order/payment ID for reconciliation
  /// [app]           — Preferred UPI app (defaults to any)
  Future<UpiPaymentResult> pay({
    required String merchantVpa,
    required String merchantName,
    required double amount,
    required String transactionId,
    UpiPaymentApp app = UpiPaymentApp.any,
  }) async {
    try {
      final formattedAmount = amount.toStringAsFixed(2);
      final encodedName = Uri.encodeComponent(merchantName);
      final encodedNote = Uri.encodeComponent('INFURNUS Ride Payment');
      final query =
          'pa=$merchantVpa&pn=$encodedName&tr=$transactionId&tid=$transactionId&tn=$encodedNote&am=$formattedAmount&cu=INR';

      final candidateUris = <String>[];
      switch (app) {
        case UpiPaymentApp.phonePe:
          candidateUris.add('phonepe://pay?$query');
          candidateUris.add('upi://pay?$query');
          break;
        case UpiPaymentApp.googlePay:
          candidateUris.add('tez://upi/pay?$query');
          candidateUris.add('upi://pay?$query');
          break;
        case UpiPaymentApp.paytm:
          candidateUris.add('paytmmp://pay?$query');
          candidateUris.add('upi://pay?$query');
          break;
        case UpiPaymentApp.any:
          candidateUris.add('upi://pay?$query');
          break;
      }

      Uri? targetUri;
      for (final uriStr in candidateUris) {
        final parsed = Uri.parse(uriStr);
        if (await canLaunchUrl(parsed)) {
          targetUri = parsed;
          break;
        }
      }

      // If specific scheme didn't return true from canLaunchUrl, fallback to standard upi:// scheme
      targetUri ??= Uri.parse('upi://pay?$query');

      final launched = await launchUrl(
        targetUri,
        mode: LaunchMode.externalApplication,
      );

      if (!launched) {
        return UpiPaymentResult(
          success: false,
          rawStatus: 'NOT_LAUNCHED',
          errorMessage:
              'Could not open ${_appDisplayName(app)}. Please ensure a UPI app is installed.',
        );
      }

      return UpiPaymentResult(
        success: true,
        rawStatus: 'LAUNCHED',
        transactionId: transactionId,
      );
    } catch (e) {
      debugPrint('UpiPaymentService error: $e');
      return UpiPaymentResult(
        success: false,
        rawStatus: 'ERROR',
        errorMessage: 'Unable to open UPI payment: $e',
      );
    }
  }

  String _appDisplayName(UpiPaymentApp app) {
    switch (app) {
      case UpiPaymentApp.phonePe:
        return 'PhonePe';
      case UpiPaymentApp.googlePay:
        return 'Google Pay';
      case UpiPaymentApp.paytm:
        return 'Paytm';
      case UpiPaymentApp.any:
        return 'UPI App';
    }
  }
}

final upiPaymentServiceProvider = Provider<UpiPaymentService>((ref) {
  return UpiPaymentService();
});
