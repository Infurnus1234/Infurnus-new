import 'dart:io';
import 'package:dio/dio.dart';
import '../../../../core/errors/failures.dart';
import '../../domain/repositories/ride_repository.dart';
import '../datasources/ride_remote_data_source.dart';
import '../models/ride_model.dart';

class RideRepositoryImpl implements RideRepository {
  final RideRemoteDataSource remoteDataSource;

  RideRepositoryImpl(this.remoteDataSource);

  @override
  Future<RideModel> createRide(Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.createRide(data);
    } on DioException catch (e) {
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
