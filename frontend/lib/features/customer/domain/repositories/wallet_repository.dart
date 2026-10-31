import '../../data/models/wallet_model.dart';

abstract class WalletRepository {
  Future<WalletModel> getWallet();

  Future<({List<WalletTransactionModel> transactions, int totalCount})>
  getHistory({String? type, int? limit, int? offset});

  Future<Map<String, dynamic>> initiateTopUp({
    required double amount,
    required String idempotencyKey,
    String? paymentMethod,
  });

  Future<WalletModel> verifyTopUp({
    required String orderId,
    String? referenceId,
    required double amount,
    required String idempotencyKey,
    String? paymentMethod,
  });

  Future<Map<String, dynamic>> pay({
    required String targetType,
    required String targetId,
    required double amount,
    String? note,
    required String idempotencyKey,
    String? authConfirmation,
  });

  Future<RecipientDetailsModel> resolveRecipient({
    required String targetType,
    required String targetId,
  });
}
