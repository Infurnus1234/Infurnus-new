import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/failures.dart';
import '../../domain/repositories/wallet_repository.dart';
import '../datasources/wallet_remote_data_source.dart';
import '../models/wallet_model.dart';

class WalletRepositoryImpl implements WalletRepository {
  final WalletRemoteDataSource _remoteDataSource;

  WalletRepositoryImpl(this._remoteDataSource);

  @override
  Future<double> quotePayment(double amount) =>
      _remoteDataSource.quotePayment(amount);

  @override
  Future<WalletModel> getWallet() async {
    try {
      return await _remoteDataSource.getWallet();
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<({List<WalletTransactionModel> transactions, int totalCount})>
  getHistory({String? type, int? limit, int? offset}) async {
    try {
      final data = await _remoteDataSource.getHistory(
        type: type,
        limit: limit,
        offset: offset,
      );
      final rawList = data['transactions'] as List? ?? [];
      final transactions = rawList
          .map(
            (item) =>
                WalletTransactionModel.fromJson(item as Map<String, dynamic>),
          )
          .toList();
      final totalCount =
          (data['totalCount'] as num?)?.toInt() ?? transactions.length;

      return (transactions: transactions, totalCount: totalCount);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<Map<String, dynamic>> initiateTopUp({
    required double amount,
    required String idempotencyKey,
    String? paymentMethod,
  }) async {
    try {
      return await _remoteDataSource.initiateTopUp(
        amount: amount,
        idempotencyKey: idempotencyKey,
        paymentMethod: paymentMethod,
      );
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<WalletModel> verifyTopUp({
    required String orderId,
    String? referenceId,
    required double amount,
    required String idempotencyKey,
    String? paymentMethod,
  }) async {
    try {
      final res = await _remoteDataSource.verifyTopUp(
        orderId: orderId,
        referenceId: referenceId,
        amount: amount,
        idempotencyKey: idempotencyKey,
        paymentMethod: paymentMethod,
      );
      final walletJson = res['wallet'] as Map<String, dynamic>?;
      if (walletJson != null) {
        return WalletModel.fromJson(walletJson);
      }
      return await getWallet();
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
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
    try {
      return await _remoteDataSource.pay(
        targetType: targetType,
        targetId: targetId,
        amount: amount,
        note: note,
        idempotencyKey: idempotencyKey,
        authConfirmation: authConfirmation,
      );
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<RecipientDetailsModel> resolveRecipient({
    required String targetType,
    required String targetId,
  }) async {
    try {
      return await _remoteDataSource.resolveRecipient(
        targetType: targetType,
        targetId: targetId,
      );
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  Failure _handleDioException(DioException e) {
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.connectionError ||
        e.error is SocketException) {
      return NetworkFailure('Please check your internet connection.');
    }

    final statusCode = e.response?.statusCode;
    final data = e.response?.data;
    String? serverMsg;

    if (data is Map) {
      if (data['message'] != null && data['message'] is String) {
        serverMsg = data['message'] as String;
      } else if (data['error'] is Map && data['error']['message'] != null) {
        serverMsg = data['error']['message'].toString();
      } else if (data['error'] is String) {
        serverMsg = data['error'] as String;
      }
    }

    // Filter out technical exception strings (like Dio's default validateStatus text)
    if (serverMsg != null &&
        (serverMsg.contains('validateStatus') ||
            serverMsg.contains('DioException') ||
            serverMsg.contains('RequestOptions'))) {
      serverMsg = null;
    }

    if (statusCode == 409) {
      return ServerFailure(
        serverMsg ?? 'Wallet conflict occurred. Please refresh to continue.',
      );
    }
    if (statusCode == 401 || statusCode == 403) {
      return ServerFailure('Session expired. Please log in again.');
    }
    if (statusCode == 404) {
      return ServerFailure('Wallet not found. Please contact support.');
    }
    if (statusCode != null && statusCode >= 500) {
      return ServerFailure(
        'Unable to connect to wallet services. Please try again later.',
      );
    }

    return ServerFailure(
      serverMsg ?? "Couldn't load wallet. Please try again.",
    );
  }
}

final walletRepositoryProvider = Provider<WalletRepository>((ref) {
  final remoteDataSource = ref.read(walletRemoteDataSourceProvider);
  return WalletRepositoryImpl(remoteDataSource);
});
