import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/dio_client.dart';
import '../models/wallet_model.dart';

abstract class WalletRemoteDataSource {
  Future<WalletModel> getWallet();
  Future<Map<String, dynamic>> getHistory({
    String? type,
    int? limit,
    int? offset,
  });
  Future<Map<String, dynamic>> initiateTopUp({
    required double amount,
    required String idempotencyKey,
    String? paymentMethod,
  });
  Future<Map<String, dynamic>> verifyTopUp({
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

class WalletRemoteDataSourceImpl implements WalletRemoteDataSource {
  final Dio _dio;

  WalletRemoteDataSourceImpl(this._dio);

  @override
  Future<WalletModel> getWallet() async {
    final response = await _dio.get('/wallet');
    final data = response.data['data'] as Map<String, dynamic>;
    return WalletModel.fromJson(data);
  }

  @override
  Future<Map<String, dynamic>> getHistory({
    String? type,
    int? limit,
    int? offset,
  }) async {
    final response = await _dio.get(
      '/wallet/history',
      queryParameters: {
        if (type != null && type != 'all') 'type': type,
        if (limit != null) 'limit': limit,
        if (offset != null) 'offset': offset,
      },
    );
    return response.data['data'] as Map<String, dynamic>;
  }

  @override
  Future<Map<String, dynamic>> initiateTopUp({
    required double amount,
    required String idempotencyKey,
    String? paymentMethod,
  }) async {
    final response = await _dio.post(
      '/wallet/topup/initiate',
      data: {
        'amount': amount,
        'idempotencyKey': idempotencyKey,
        'paymentMethod': paymentMethod ?? 'upi',
      },
    );
    return response.data['data'] as Map<String, dynamic>;
  }

  @override
  Future<Map<String, dynamic>> verifyTopUp({
    required String orderId,
    String? referenceId,
    required double amount,
    required String idempotencyKey,
    String? paymentMethod,
  }) async {
    final response = await _dio.post(
      '/wallet/topup/verify',
      data: {
        'orderId': orderId,
        if (referenceId != null) 'referenceId': referenceId,
        'amount': amount,
        'idempotencyKey': idempotencyKey,
        'paymentMethod': paymentMethod ?? 'UPI',
      },
    );
    return response.data['data'] as Map<String, dynamic>;
  }

  @override
  Future<Map<String, dynamic>> pay({
    required String targetType,
    required String targetId,
    required double amount,
    String? note,
    required String idempotencyKey,
    String? authConfirmation,
  }) async {
    final response = await _dio.post(
      '/wallet/pay',
      data: {
        'targetType': targetType,
        'targetId': targetId,
        'amount': amount,
        if (note != null && note.isNotEmpty) 'note': note,
        'idempotencyKey': idempotencyKey,
        if (authConfirmation != null) 'authConfirmation': authConfirmation,
      },
    );
    return response.data['data'] as Map<String, dynamic>;
  }

  @override
  Future<RecipientDetailsModel> resolveRecipient({
    required String targetType,
    required String targetId,
  }) async {
    final response = await _dio.post(
      '/wallet/resolve-recipient',
      data: {'targetType': targetType, 'targetId': targetId},
    );
    final data = response.data['data'] as Map<String, dynamic>;
    return RecipientDetailsModel.fromJson(data);
  }
}

final walletRemoteDataSourceProvider = Provider<WalletRemoteDataSource>((ref) {
  final dio = ref.read(dioProvider);
  return WalletRemoteDataSourceImpl(dio);
});
