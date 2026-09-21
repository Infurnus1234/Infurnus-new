import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:infurnus/core/services/cashfree_checkout_service.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart' as model;
import 'package:infurnus/features/customer/domain/usecases/capture_payment_use_case.dart';
import 'package:infurnus/features/customer/domain/usecases/initiate_payment_use_case.dart';
import 'package:infurnus/features/customer/domain/usecases/list_payments_use_case.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_use_case_providers.dart';

class MockInitiatePaymentUseCase implements InitiatePaymentUseCase {
  Map<String, dynamic>? lastParams;
  Map<String, dynamic> resultToReturn = {
    'id': 'pay-12345',
    'status': 'INITIATED',
    'amount': 450.0,
    'provider': 'cashfree',
    'providerOrderId': 'order_pay-12345',
    'paymentSessionId': 'session_abc_123',
  };
  bool shouldThrow = false;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Map<String, dynamic>> execute({
    required String rideId,
    required double amount,
    required String paymentMethod,
  }) async {
    if (shouldThrow) throw Exception('Payment initiation failed');
    lastParams = {
      'rideId': rideId,
      'amount': amount,
      'paymentMethod': paymentMethod,
    };
    return resultToReturn;
  }
}

class MockCapturePaymentUseCase implements CapturePaymentUseCase {
  Map<String, dynamic>? lastParams;
  Map<String, dynamic> resultToReturn = {
    'id': 'pay-12345',
    'status': 'CAPTURED',
    'providerPaymentId': 'cf_pay_998877',
  };
  bool shouldThrow = false;
  int callCount = 0;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Map<String, dynamic>> execute({
    required String paymentId,
    String? providerPaymentId,
  }) async {
    callCount++;
    if (shouldThrow) throw Exception('Server verification network error');
    lastParams = {
      'paymentId': paymentId,
      'providerPaymentId': providerPaymentId,
    };
    return resultToReturn;
  }
}

class MockListPaymentsUseCase implements ListPaymentsUseCase {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<Map<String, dynamic>>> execute({int? limit}) async {
    return [];
  }
}

class MockCashfreeCheckoutService implements CashfreeCheckoutService {
  String? lastOrderId;
  String? lastPaymentSessionId;
  CashfreeCheckoutResult resultToReturn = const CashfreeCheckoutResult(
    status: CashfreeCheckoutStatus.success,
    orderId: 'order_pay-12345',
    referenceId: 'cf_pay_998877',
  );
  int callCount = 0;

  @override
  Future<CashfreeCheckoutResult> startCheckout({
    required String orderId,
    required String paymentSessionId,
    bool isSandbox = true,
  }) async {
    callCount++;
    lastOrderId = orderId;
    lastPaymentSessionId = paymentSessionId;
    return resultToReturn;
  }
}

void main() {
  group('Cashfree Flutter Checkout & Lifecycle Verification', () {
    late MockInitiatePaymentUseCase mockInitiate;
    late MockCapturePaymentUseCase mockCapture;
    late MockListPaymentsUseCase mockListPayments;
    late MockCashfreeCheckoutService mockCheckoutService;
    late ProviderContainer container;

    setUp(() {
      mockInitiate = MockInitiatePaymentUseCase();
      mockCapture = MockCapturePaymentUseCase();
      mockListPayments = MockListPaymentsUseCase();
      mockCheckoutService = MockCashfreeCheckoutService();

      container = ProviderContainer(
        overrides: [
          initiatePaymentUseCaseProvider.overrideWithValue(mockInitiate),
          capturePaymentUseCaseProvider.overrideWithValue(mockCapture),
          listPaymentsUseCaseProvider.overrideWithValue(mockListPayments),
          cashfreeCheckoutServiceProvider.overrideWithValue(mockCheckoutService),
        ],
      );
    });

    tearDown(() {
      container.dispose();
    });

    void setCompletedRide() {
      final notifier = container.read(rideProvider.notifier);
      notifier.state = notifier.state.copyWith(
        status: RideStatus.completed,
        currentRide: model.RideModel(
          id: 'ride-abc-123',
          customerId: 'cust-1',
          pickup: model.RideLocation(latitude: 12.97, longitude: 77.59),
          destination: model.RideLocation(latitude: 12.93, longitude: 77.62),
          pickupAddress: 'MG Road',
          destinationAddress: 'Koramangala',
          status: model.RideStatus.completed,
          fareEstimate: 450.0,
          sector: 'passenger',
          vehicleCategory: 'sedan',
          createdAt: DateTime.now(),
          updatedAt: DateTime.now(),
        ),
      );
    }

    test('Payment initiation passes rideId and paymentMethod correctly', () async {
      setCompletedRide();

      final notifier = container.read(rideProvider.notifier);
      final success = await notifier.initiateTripPayment(
        amount: 450.0,
        paymentMethod: 'cashfree',
      );

      expect(success, isTrue);
      expect(mockInitiate.lastParams?['rideId'], 'ride-abc-123');
      expect(mockInitiate.lastParams?['paymentMethod'], 'cashfree');
    });

    test('Payment session handling: extracts paymentSessionId and opens Cashfree checkout', () async {
      setCompletedRide();

      final notifier = container.read(rideProvider.notifier);
      await notifier.initiateTripPayment(
        amount: 450.0,
        paymentMethod: 'cashfree',
      );

      expect(mockCheckoutService.callCount, 1);
      expect(mockCheckoutService.lastOrderId, 'order_pay-12345');
      expect(mockCheckoutService.lastPaymentSessionId, 'session_abc_123');
    });

    test('CRITICAL: Checkout success callback alone MUST NOT mark payment as paid without server confirmation', () async {
      setCompletedRide();

      // Server verification reports non-captured status
      mockCapture.resultToReturn = {
        'id': 'pay-12345',
        'status': 'INITIATED', // NOT CAPTURED
      };

      final notifier = container.read(rideProvider.notifier);
      final success = await notifier.initiateTripPayment(
        amount: 450.0,
        paymentMethod: 'cashfree',
      );

      // Checkout callback was success, but backend said not CAPTURED
      expect(mockCheckoutService.callCount, 1);
      expect(mockCapture.callCount, 1);
      expect(success, isFalse);
      expect(notifier.state.paymentStatus, 'unpaid');
      expect(notifier.state.errorMessage, contains('verification failed'));
    });

    test('Full success flow: checkout success followed by server CAPTURED marks paymentStatus as paid', () async {
      setCompletedRide();

      final notifier = container.read(rideProvider.notifier);
      final success = await notifier.initiateTripPayment(
        amount: 450.0,
        paymentMethod: 'cashfree',
      );

      expect(success, isTrue);
      expect(mockCapture.callCount, 1);
      expect(mockCapture.lastParams?['paymentId'], 'pay-12345');
      expect(mockCapture.lastParams?['providerPaymentId'], 'cf_pay_998877');
      expect(notifier.state.paymentStatus, 'paid');
      expect(notifier.state.errorMessage, isNull);
    });

    test('User cancellation: does not call backend capture, sets status unpaid', () async {
      setCompletedRide();

      mockCheckoutService.resultToReturn = const CashfreeCheckoutResult(
        status: CashfreeCheckoutStatus.cancelled,
        orderId: 'order_pay-12345',
        errorMessage: 'User dismissed checkout',
      );

      final notifier = container.read(rideProvider.notifier);
      final success = await notifier.initiateTripPayment(
        amount: 450.0,
        paymentMethod: 'cashfree',
      );

      expect(success, isFalse);
      expect(mockCapture.callCount, 0); // Must NOT call capture
      expect(notifier.state.paymentStatus, 'unpaid');
      expect(notifier.state.errorMessage, contains('cancelled by user'));
    });

    test('Gateway failure: does not call backend capture, exposes gateway error message', () async {
      setCompletedRide();

      mockCheckoutService.resultToReturn = const CashfreeCheckoutResult(
        status: CashfreeCheckoutStatus.failed,
        orderId: 'order_pay-12345',
        errorMessage: 'Card authentication failed with 3DS',
      );

      final notifier = container.read(rideProvider.notifier);
      final success = await notifier.initiateTripPayment(
        amount: 450.0,
        paymentMethod: 'cashfree',
      );

      expect(success, isFalse);
      expect(mockCapture.callCount, 0);
      expect(notifier.state.paymentStatus, 'unpaid');
      expect(notifier.state.errorMessage, 'Card authentication failed with 3DS');
    });

    test('Network error during backend verification leaves state unpaid', () async {
      setCompletedRide();

      mockCapture.shouldThrow = true;

      final notifier = container.read(rideProvider.notifier);
      final success = await notifier.initiateTripPayment(
        amount: 450.0,
        paymentMethod: 'cashfree',
      );

      expect(success, isFalse);
      expect(notifier.state.paymentStatus, 'unpaid');
      expect(notifier.state.errorMessage, contains('network error'));
    });
  });
}
