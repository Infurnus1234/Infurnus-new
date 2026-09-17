import 'dart:io';
import 'package:dio/dio.dart';
import '../../../../core/errors/failures.dart';
import '../../domain/repositories/driver_repository.dart';
import '../datasources/driver_remote_data_source.dart';
import '../models/partner_model.dart';
import '../models/partner_document_model.dart';
import '../models/vehicle_model.dart';
import '../models/driver_profile_model.dart';
import '../models/driver_history_model.dart';
import '../../../auth/data/models/user_preferences_model.dart';
import '../../../customer/data/models/ride_model.dart';

class DriverRepositoryImpl implements DriverRepository {
  final DriverRemoteDataSource remoteDataSource;

  DriverRepositoryImpl(this.remoteDataSource);

  @override
  Future<PartnerModel> createPartner(Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.createPartner(data);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<PartnerModel> getPartner(String id) async {
    try {
      return await remoteDataSource.getPartner(id);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<PartnerModel?> getMyPartner() async {
    try {
      return await remoteDataSource.getMyPartner();
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<DriverProfileModel?> getDriverProfile() async {
    try {
      return await remoteDataSource.getDriverProfile();
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<DriverProfileModel> upsertDriverProfile(Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.upsertDriverProfile(data);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<DriverHistoryModel> getDriverHistory({int limit = 20}) async {
    try {
      return await remoteDataSource.getDriverHistory(limit: limit);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<PartnerModel> updatePartner(String id, Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.updatePartner(id, data);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<List<PartnerDocumentModel>> listDocuments(String partnerId) async {
    try {
      return await remoteDataSource.listDocuments(partnerId);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<PartnerDocumentModel> addDocument(String partnerId, Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.addDocument(partnerId, data);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<PartnerDocumentModel> updateDocument(String partnerId, String documentId, Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.updateDocument(partnerId, documentId, data);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<void> updateAvailability(String status) async {
    try {
      await remoteDataSource.updateAvailability(status);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<void> updateLocation(Map<String, dynamic> data) async {
    try {
      await remoteDataSource.updateLocation(data);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<List<RideModel>> getAvailableRides() async {
    try {
      return await remoteDataSource.getAvailableRides();
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<RideModel> acceptRide(String rideId) async {
    try {
      return await remoteDataSource.acceptRide(rideId);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<RideModel> completeRide(String rideId) async {
    try {
      return await remoteDataSource.completeRide(rideId);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<RideModel> transitionRide(String rideId, String status) async {
    try {
      return await remoteDataSource.transitionRide(rideId, status);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<VehicleModel> createVehicle(Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.createVehicle(data);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<List<VehicleModel>> listVehicles({String? driverProfileId}) async {
    try {
      return await remoteDataSource.listVehicles(driverProfileId: driverProfileId);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<VehicleModel> getVehicle(String id) async {
    try {
      return await remoteDataSource.getVehicle(id);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<VehicleModel> updateVehicle(String id, Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.updateVehicle(id, data);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<VehicleModel> deactivateVehicle(String id) async {
    try {
      return await remoteDataSource.deactivateVehicle(id);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<UserPreferencesModel> getUserPreferences(String userId) async {
    try {
      return await remoteDataSource.getUserPreferences(userId);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<UserPreferencesModel> updateUserPreferences(String userId, Map<String, dynamic> data) async {
    try {
      return await remoteDataSource.updateUserPreferences(userId, data);
    } on DioException catch (e) {
      throw _handleDioException(e);
    } catch (e) {
      throw ServerFailure(e.toString());
    }
  }

  @override
  Future<List<UserHistoryModel>> getUserHistory(String userId, {int limit = 20}) async {
    try {
      return await remoteDataSource.getUserHistory(userId, limit: limit);
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
