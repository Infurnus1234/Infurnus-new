import 'dart:io';

import 'package:dio/dio.dart';

import '../../../../core/errors/failures.dart';
import '../../domain/repositories/ride_repository.dart';
import '../datasources/ride_remote_data_source.dart';
import '../models/fare_estimate_model.dart';
import '../models/fleet_vehicle_model.dart';
import '../models/ride_model.dart';

class RideRepositoryImpl implements RideRepository {
  final RideRemoteDataSource remoteDataSource;

  RideRepositoryImpl(this.remoteDataSource);

  @override
  Future<RideModel> createRide(Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.createRide(data);
    } on DioException catch (e) {
      final body = e.response?.data;
      final error = body is Map ? body['error'] : null;
      if (error is Map &&
          error['code'] is String &&
          (error['code'] as String).startsWith('FARE_') &&
          error['message'] is String) {
        throw ServerFailure(error['message'] as String);
      }
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<List<RideModel>> listRides({String? status, int? limit}) async {
    try {
      return await remoteDataSource.listRides(status: status, limit: limit);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<RideModel> getRide(String id) async {
    try {
      return await remoteDataSource.getRide(id);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<RideModel> cancelRide(String id, String reason) async {
    try {
      return await remoteDataSource.cancelRide(id, reason);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.estimateFare(data);
    } on DioException catch (e) {
      final body = e.response?.data;
      final error = body is Map ? body['error'] : null;
      if (error is Map &&
          error['code'] == 'FARE_CONFIGURATION_MISSING' &&
          error['message'] is String &&
          (error['message'] as String).isNotEmpty) {
        return FareEstimateModel.unavailable(error['message'].toString());
      }
      if (error is Map && error['message'] is String) {
        throw ServerFailure(error['message'] as String);
      }
      throw _handleDioException(e);
    } on FormatException {
      throw ServerFailure('We could not load a valid fare. Please try again.');
    } on TypeError {
      throw ServerFailure('We could not load a valid fare. Please try again.');
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<Map<String, dynamic>> submitRating({
    required String rideId,
    required int rating,
    String? review,
  }) async {
    try {
      await remoteDataSource.submitRating(rideId, rating, review: review);
      return {'success': true};
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<Map<String, dynamic>> initiatePayment({
    required String rideId,
    required double amount,
    required String paymentMethod,
  }) async {
    try {
      return await remoteDataSource.initiatePayment({
        'rideId': rideId,
        'amount': amount,
        'paymentMethod': paymentMethod,
      });
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<Map<String, dynamic>> capturePayment({
    required String paymentId,
    String? providerPaymentId,
  }) async {
    try {
      return await remoteDataSource.capturePayment(
        paymentId,
        providerPaymentId: providerPaymentId,
      );
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<List<Map<String, dynamic>>> listPayments({int? limit}) async {
    try {
      final list = await remoteDataSource.listPayments();
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<List<FleetVehicleModel>> getFleet({
    String? sector,
    String? category,
  }) async {
    try {
      return await remoteDataSource.getFleet(
        sector: sector,
        category: category,
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
        e.error is SocketException) {
      return NetworkFailure();
    }

    final message = e.response?.data?['message'] ?? e.message;
    return ServerFailure(message.toString());
  }
}
