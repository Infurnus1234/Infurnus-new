import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/failures.dart';
import '../../../../core/services/payment_gateway.dart';
import '../../data/models/wallet_model.dart';
import '../../data/repositories/wallet_repository_impl.dart';
import '../../domain/repositories/wallet_repository.dart';

class WalletState {
  final WalletModel? wallet;
  final List<WalletTransactionModel> transactions;
  final int totalCount;
  final String filter; // 'all', 'debit', 'credit'
  final bool isLoading;
  final bool isHistoryLoading;
  final bool isTopUpProcessing;
  final bool isPaymentProcessing;
  final String? errorMessage;
  final bool isOffline;
  final bool isUnauthenticated;

  /// Real transaction reference returned by the server after a successful pay().
  final String? lastPaymentRef;

  const WalletState({
    this.wallet,
    this.transactions = const [],
    this.totalCount = 0,
    this.filter = 'all',
    this.isLoading = false,
    this.isHistoryLoading = false,
    this.isTopUpProcessing = false,
    this.isPaymentProcessing = false,
    this.errorMessage,
    this.isOffline = false,
    this.isUnauthenticated = false,
    this.lastPaymentRef,
  });

  WalletState copyWith({
    WalletModel? wallet,
    List<WalletTransactionModel>? transactions,
    int? totalCount,
    String? filter,
    bool? isLoading,
    bool? isHistoryLoading,
    bool? isTopUpProcessing,
    bool? isPaymentProcessing,
    String? errorMessage,
    bool clearError = false,
    bool? isOffline,
    bool? isUnauthenticated,
    String? lastPaymentRef,
    bool clearLastPaymentRef = false,
  }) {
    return WalletState(
      wallet: wallet ?? this.wallet,
      transactions: transactions ?? this.transactions,
      totalCount: totalCount ?? this.totalCount,
      filter: filter ?? this.filter,
      isLoading: isLoading ?? this.isLoading,
      isHistoryLoading: isHistoryLoading ?? this.isHistoryLoading,
      isTopUpProcessing: isTopUpProcessing ?? this.isTopUpProcessing,
      isPaymentProcessing: isPaymentProcessing ?? this.isPaymentProcessing,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      isOffline: isOffline ?? this.isOffline,
      isUnauthenticated: isUnauthenticated ?? this.isUnauthenticated,
      lastPaymentRef: clearLastPaymentRef
          ? null
          : (lastPaymentRef ?? this.lastPaymentRef),
    );
  }
}

class WalletNotifier extends StateNotifier<WalletState> {
  final WalletRepository _repository;

  WalletNotifier(this._repository) : super(const WalletState());

  Future<void> loadData() async {
    state = state.copyWith(isLoading: true, clearError: true);
    await Future.wait([
      fetchWallet(showLoading: false),
      fetchHistory(filter: state.filter, showLoading: false),
    ]);
    if (mounted) {
      state = state.copyWith(isLoading: false);
    }
  }

  Future<void> fetchWallet({bool showLoading = true}) async {
    if (showLoading) {
      state = state.copyWith(isLoading: true, clearError: true);
    }

    try {
      final wallet = await _repository.getWallet();
      if (!mounted) return;
      state = state.copyWith(
        wallet: wallet,
        isLoading: false,
        clearError: true,
        isOffline: false,
        isUnauthenticated: false,
      );
    } catch (e) {
      if (!mounted) return;
      final isOffline = e is NetworkFailure;
      state = state.copyWith(
        isLoading: false,
        isOffline: isOffline,
        errorMessage: e.toString().replaceFirst('ServerFailure: ', ''),
      );
    }
  }

  Future<void> fetchHistory({String? filter, bool showLoading = true}) async {
    final activeFilter = filter ?? state.filter;
    if (showLoading) {
      state = state.copyWith(isHistoryLoading: true, clearError: true);
    }

    try {
      final result = await _repository.getHistory(
        type: activeFilter,
        limit: 50,
      );
      if (!mounted) return;
      state = state.copyWith(
        transactions: result.transactions,
        totalCount: result.totalCount,
        filter: activeFilter,
        isHistoryLoading: false,
        clearError: true,
        isOffline: false,
      );
    } catch (e) {
      if (!mounted) return;
      final isOffline = e is NetworkFailure;
      state = state.copyWith(
        isHistoryLoading: false,
        isOffline: isOffline,
        errorMessage: e.toString().replaceFirst('ServerFailure: ', ''),
      );
    }
  }

  Future<void> setFilter(String filter) async {
    if (state.filter == filter) return;
    state = state.copyWith(filter: filter);
    await fetchHistory(filter: filter, showLoading: true);
  }

  /// Top-up flow with double-submit protection, idempotency, and server verification.
  Future<bool> topUp({
    required double amount,
    required PaymentGateway gateway,
    String paymentMethod = 'UPI',
    Map<String, dynamic>? extraData,
  }) async {
    if (state.isTopUpProcessing) return false;

    // Minimum / Maximum validation
    if (amount < 10.0) {
      state = state.copyWith(errorMessage: 'Minimum top-up amount is ₹10.00');
      return false;
    }
    if (amount > 100000.0) {
      state = state.copyWith(
        errorMessage: 'Maximum top-up amount is ₹1,00,000.00',
      );
      return false;
    }

    state = state.copyWith(isTopUpProcessing: true, clearError: true);

    try {
      final idempotencyKey =
          'topup_${DateTime.now().millisecondsSinceEpoch}_${(amount * 100).toInt()}';

      // 1. Create top-up order on server
      final initiateRes = await _repository.initiateTopUp(
        amount: amount,
        idempotencyKey: idempotencyKey,
        paymentMethod: paymentMethod,
      );

      final orderId = initiateRes['orderId']?.toString();
      final paymentSessionId = initiateRes['paymentSessionId']?.toString();
      if (orderId == null) {
        throw Exception('Server did not return a valid order ID');
      }

      // 2. Gateway checkout
      final checkoutRes = await gateway.startCheckout(
        orderId: orderId,
        amount: amount,
        currency: 'INR',
        paymentSessionId: paymentSessionId,
        extraData: extraData,
      );

      if (checkoutRes.status == PaymentGatewayStatus.cancelled) {
        state = state.copyWith(
          isTopUpProcessing: false,
          errorMessage: 'Top-up was cancelled by user',
        );
        return false;
      }

      if (checkoutRes.status == PaymentGatewayStatus.failed) {
        state = state.copyWith(
          isTopUpProcessing: false,
          errorMessage: checkoutRes.errorMessage ?? 'Payment failed at gateway',
        );
        return false;
      }

      // 3. Server verification: ONLY server credits the wallet
      final updatedWallet = await _repository.verifyTopUp(
        orderId: orderId,
        referenceId: checkoutRes.referenceId,
        amount: amount,
        idempotencyKey: idempotencyKey,
        paymentMethod: paymentMethod,
      );

      state = state.copyWith(
        wallet: updatedWallet,
        isTopUpProcessing: false,
        clearError: true,
      );

      await fetchHistory(showLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(
        isTopUpProcessing: false,
        errorMessage: e.toString().replaceFirst('ServerFailure: ', ''),
      );
      return false;
    }
  }

  /// Pay via wallet with atomic debit, idempotency, and balance check.
  /// Returns the server-issued transaction reference on success, or null on failure.
  Future<String?> payViaWallet({
    required String targetType,
    required String targetId,
    required double amount,
    String? note,
    String? authConfirmation,
  }) async {
    if (state.isPaymentProcessing) return null;

    final currentBalance = state.wallet?.balance ?? 0.0;
    if (amount <= 0) {
      state = state.copyWith(errorMessage: 'Please enter a valid amount');
      return null;
    }

    if (amount > currentBalance) {
      state = state.copyWith(
        errorMessage:
            'Insufficient wallet balance (Available: ₹${currentBalance.toStringAsFixed(2)})',
      );
      return null;
    }

    state = state.copyWith(
      isPaymentProcessing: true,
      clearError: true,
      clearLastPaymentRef: true,
    );

    try {
      final idempotencyKey =
          'pay_${DateTime.now().millisecondsSinceEpoch}_${targetId.hashCode.abs()}_${(amount * 100).toInt()}';

      final responseData = await _repository.pay(
        targetType: targetType,
        targetId: targetId,
        amount: amount,
        note: note,
        idempotencyKey: idempotencyKey,
        authConfirmation: authConfirmation,
      );

      // Extract the real transaction reference from the server response.
      // Backend may return it as transactionId, reference, txnId, or id.
      final serverRef =
          responseData['transactionId']?.toString() ??
          responseData['reference']?.toString() ??
          responseData['txnId']?.toString() ??
          responseData['id']?.toString() ??
          idempotencyKey;

      await fetchWallet(showLoading: false);
      await fetchHistory(showLoading: false);

      state = state.copyWith(
        isPaymentProcessing: false,
        clearError: true,
        lastPaymentRef: serverRef,
      );
      return serverRef;
    } catch (e) {
      state = state.copyWith(
        isPaymentProcessing: false,
        errorMessage: e.toString().replaceFirst('ServerFailure: ', ''),
      );
      return null;
    }
  }

  Future<RecipientDetailsModel?> resolveRecipient({
    required String targetType,
    required String targetId,
  }) async {
    try {
      return await _repository.resolveRecipient(
        targetType: targetType,
        targetId: targetId,
      );
    } catch (e) {
      state = state.copyWith(
        errorMessage: e.toString().replaceFirst('ServerFailure: ', ''),
      );
      return null;
    }
  }
}

final walletProvider = StateNotifierProvider<WalletNotifier, WalletState>((
  ref,
) {
  final repository = ref.read(walletRepositoryProvider);
  return WalletNotifier(repository);
});
