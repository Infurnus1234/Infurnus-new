import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/services/cashfree_checkout_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('flutter_cashfree_pg_sdk');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  for (final scenario in ['success', 'cancelled', 'failed']) {
    test(
      'native web checkout preserves session and $scenario response',
      () async {
        final calls = <MethodCall>[];
        messenger.setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          if (call.method == 'response') return null;
          expect(call.method, 'doWebPayment');
          final payload = Map<Object?, Object?>.from(call.arguments as Map);
          expect(payload['session'], {
            'environment': 'SANDBOX',
            'order_id': 'order_fixture',
            'payment_session_id': 'session_fixture',
          });
          return jsonEncode({
            'status': scenario == 'success' ? 'success' : 'failed',
            'data': {
              'order_id': 'order_fixture',
              'status': scenario == 'cancelled' ? 'CANCELLED' : 'FAILED',
              'message': scenario == 'cancelled'
                  ? 'User cancelled'
                  : 'Fixture failure',
              'code': 'fixture_code',
              'type': 'fixture_type',
            },
          });
        });

        final result = await CashfreePgCheckoutService().startCheckout(
          orderId: 'order_fixture',
          paymentSessionId: 'session_fixture',
        );

        expect(
          calls.where((call) => call.method == 'doWebPayment'),
          hasLength(1),
        );
        expect(calls.where((call) => call.method == 'doPayment'), isEmpty);
        expect(result.orderId, 'order_fixture');
        expect(result.status, switch (scenario) {
          'success' => CashfreeCheckoutStatus.success,
          'cancelled' => CashfreeCheckoutStatus.cancelled,
          _ => CashfreeCheckoutStatus.failed,
        });
        if (scenario != 'success') expect(result.referenceId, 'fixture_code');
      },
    );
  }
}
