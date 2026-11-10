import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/errors/failures.dart';
import 'package:infurnus/features/customer/data/models/wallet_model.dart';
import 'package:infurnus/features/customer/domain/repositories/wallet_repository.dart';
import 'package:infurnus/features/customer/presentation/providers/wallet_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/wallet_screen.dart';
import 'package:infurnus/shared/widgets/infurnus_error_view.dart';

class MockWalletRepository implements WalletRepository {
  final Future<WalletModel> Function() onGetWallet;
  final Future<({List<WalletTransactionModel> transactions, int totalCount})>
  Function()?
  onGetHistory;

  MockWalletRepository({required this.onGetWallet, this.onGetHistory});

  @override
  Future<double> quotePayment(double amount) async =>
      throw UnimplementedError();

  @override
  Future<WalletModel> getWallet() => onGetWallet();

  @override
  Future<({List<WalletTransactionModel> transactions, int totalCount})>
  getHistory({String? type, int? limit, int? offset}) async {
    if (onGetHistory != null) {
      return onGetHistory!();
    }
    return (transactions: <WalletTransactionModel>[], totalCount: 0);
  }

  @override
  Future<Map<String, dynamic>> initiateTopUp({
    required double amount,
    required String idempotencyKey,
    String? paymentMethod,
  }) async => {};

  @override
  Future<WalletModel> verifyTopUp({
    required String orderId,
    String? referenceId,
    required double amount,
    required String idempotencyKey,
    String? paymentMethod,
  }) async => WalletModel.empty();

  @override
  Future<Map<String, dynamic>> pay({
    required String targetType,
    required String targetId,
    required double amount,
    String? note,
    required String idempotencyKey,
    String? authConfirmation,
  }) async => {};

  @override
  Future<RecipientDetailsModel> resolveRecipient({
    required String targetType,
    required String targetId,
  }) async => const RecipientDetailsModel(
    targetId: '',
    targetType: 'upi',
    displayName: 'Test',
    isVerified: true,
  );
}

void main() {
  testWidgets(
    'UA-05: WalletScreen displays success balance with transactions',
    (tester) async {
      final repo = MockWalletRepository(
        onGetWallet: () async => const WalletModel(
          userId: 'u1',
          balance: 1500.0,
          balancePaise: 150000,
          currency: 'INR',
          isActive: true,
          activityCount: 1,
        ),
        onGetHistory: () async => (
          transactions: [
            WalletTransactionModel(
              id: 'tx1',
              type: 'credit',
              amount: 1500.0,
              amountPaise: 150000,
              balanceAfter: 1500.0,
              balanceAfterPaise: 150000,
              status: 'COMPLETED',
              paymentMethod: 'UPI',
              description: 'Top-up',
              reference: 'REF123',
              createdAt: DateTime.now(),
            ),
          ],
          totalCount: 1,
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            walletProvider.overrideWith((ref) => WalletNotifier(repo)),
          ],
          child: const MaterialApp(home: WalletScreen()),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('INFURNUS Wallet & Pay'), findsOneWidget);
      expect(find.text('Available Wallet Balance'), findsOneWidget);
      expect(find.text('₹1,500.00'), findsOneWidget);
      expect(find.text('+₹1,500.00'), findsOneWidget);
      expect(find.text('1 activities'), findsOneWidget);
      expect(find.byType(InfurnusErrorView), findsNothing);
    },
  );

  testWidgets(
    'UA-05: Genuine zero balance displays ₹0 and empty state without error',
    (tester) async {
      final repo = MockWalletRepository(
        onGetWallet: () async => const WalletModel(
          userId: 'u1',
          balance: 0.0,
          balancePaise: 0,
          currency: 'INR',
          isActive: true,
          activityCount: 0,
        ),
        onGetHistory: () async =>
            (transactions: <WalletTransactionModel>[], totalCount: 0),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            walletProvider.overrideWith((ref) => WalletNotifier(repo)),
          ],
          child: const MaterialApp(home: WalletScreen()),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Available Wallet Balance'), findsOneWidget);
      expect(find.text('₹0.00'), findsOneWidget);
      expect(find.text('No transactions yet'), findsOneWidget);
      expect(find.byType(InfurnusErrorView), findsNothing);
    },
  );

  testWidgets(
    'UA-05: 409 conflict error shows friendly error and Retry, never ₹0 balance',
    (tester) async {
      final repo = MockWalletRepository(
        onGetWallet: () async => throw ServerFailure(
          'Wallet conflict occurred. Please refresh to continue.',
        ),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            walletProvider.overrideWith((ref) => WalletNotifier(repo)),
          ],
          child: const MaterialApp(home: WalletScreen()),
        ),
      );

      await tester.pumpAndSettle();

      // Verify raw exception string is NOT shown
      expect(
        find.textContaining('RequestOptions.validateStatus'),
        findsNothing,
      );
      expect(find.textContaining('DioException'), findsNothing);

      // Verify Error view is shown with Retry button and friendly message
      expect(find.byType(InfurnusErrorView), findsOneWidget);
      expect(
        find.text('Wallet conflict occurred. Please refresh to continue.'),
        findsOneWidget,
      );
      expect(find.text('Retry'), findsOneWidget);

      // Verify ₹0 balance card is NOT displayed when wallet load failed
      expect(find.text('Available Wallet Balance'), findsNothing);
      expect(find.text('₹0'), findsNothing);
    },
  );

  testWidgets(
    'UA-05: Network error shows connection error and Retry, never ₹0 balance',
    (tester) async {
      final repo = MockWalletRepository(
        onGetWallet: () async =>
            throw NetworkFailure('Please check your internet connection.'),
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            walletProvider.overrideWith((ref) => WalletNotifier(repo)),
          ],
          child: const MaterialApp(home: WalletScreen()),
        ),
      );

      await tester.pumpAndSettle();

      expect(find.byType(InfurnusErrorView), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.text('Available Wallet Balance'), findsNothing);
      expect(find.text('₹0'), findsNothing);
    },
  );
}
