import 'package:dio/dio.dart';
import '../models/partner_model.dart';
import '../models/partner_document_model.dart';
import '../models/vehicle_model.dart';
import '../../../auth/data/models/user_preferences_model.dart';
import '../../../customer/data/models/ride_model.dart';

abstract class DriverRemoteDataSource {
  Future<PartnerModel> createPartner(Map<String, dynamic> data);
  Future<PartnerModel> getPartner(String id);
  Future<PartnerModel> updatePartner(String id, Map<String, dynamic> data);
  Future<List<PartnerDocumentModel>> listDocuments(String partnerId);
  Future<PartnerDocumentModel> addDocument(String partnerId, Map<String, dynamic> data);
  Future<PartnerDocumentModel> updateDocument(String partnerId, String documentId, Map<String, dynamic> data);
  
  Future<void> updateAvailability(String status);
  Future<void> updateLocation(Map<String, dynamic> data);
  Future<RideModel> acceptRide(String rideId);
  Future<RideModel> completeRide(String rideId);
  Future<RideModel> transitionRide(String rideId, String status);

  Future<VehicleModel> createVehicle(Map<String, dynamic> data);
  Future<List<VehicleModel>> listVehicles({String? driverProfileId});
  Future<VehicleModel> getVehicle(String id);
  Future<VehicleModel> updateVehicle(String id, Map<String, dynamic> data);
  Future<VehicleModel> deactivateVehicle(String id);

  Future<UserPreferencesModel> getUserPreferences(String userId);
  Future<UserPreferencesModel> updateUserPreferences(String userId, Map<String, dynamic> data);
  Future<List<UserHistoryModel>> getUserHistory(String userId, {int limit = 20});
}

class DriverRemoteDataSourceImpl implements DriverRemoteDataSource {
  final Dio _dio;

  DriverRemoteDataSourceImpl(this._dio);

  @override
  Future<PartnerModel> createPartner(Map<String, dynamic> data) async {
    final response = await _dio.post('/partners', data: data);
    return PartnerModel.fromJson(response.data['data']);
  }

  @override
  Future<PartnerModel> getPartner(String id) async {
    final response = await _dio.get('/partners/$id');
    return PartnerModel.fromJson(response.data['data']);
  }

  @override
  Future<PartnerModel> updatePartner(String id, Map<String, dynamic> data) async {
    final response = await _dio.patch('/partners/$id', data: data);
    return PartnerModel.fromJson(response.data['data']);
  }

  @override
  Future<List<PartnerDocumentModel>> listDocuments(String partnerId) async {
    final response = await _dio.get('/partners/$partnerId/documents');
    final List list = response.data['data'];
    return list.map((e) => PartnerDocumentModel.fromJson(e)).toList();
  }

  @override
  Future<PartnerDocumentModel> addDocument(String partnerId, Map<String, dynamic> data) async {
    final response = await _dio.post('/partners/$partnerId/documents', data: data);
    return PartnerDocumentModel.fromJson(response.data['data']);
  }

  @override
  Future<PartnerDocumentModel> updateDocument(String partnerId, String documentId, Map<String, dynamic> data) async {
    final response = await _dio.patch('/partners/$partnerId/documents/$documentId', data: data);
    return PartnerDocumentModel.fromJson(response.data['data']);
  }

  @override
  Future<void> updateAvailability(String status) async {
    await _dio.patch('/rides/driver/availability', data: {'status': status});
  }

  @override
  Future<void> updateLocation(Map<String, dynamic> data) async {
    await _dio.post('/rides/driver/location', data: data);
  }

  @override
  Future<RideModel> acceptRide(String rideId) async {
    final response = await _dio.post('/rides/$rideId/accept');
    return RideModel.fromJson(response.data['data']);
  }

  @override
  Future<RideModel> completeRide(String rideId) async {
    final response = await _dio.post('/rides/$rideId/complete');
    return RideModel.fromJson(response.data['data']);
  }

  @override
  Future<RideModel> transitionRide(String rideId, String status) async {
    final response = await _dio.post('/rides/$rideId/status', data: {'status': status});
    return RideModel.fromJson(response.data['data']);
  }

  @override
  Future<VehicleModel> createVehicle(Map<String, dynamic> data) async {
    final response = await _dio.post('/vehicles', data: data);
    return VehicleModel.fromJson(response.data['data']);
  }

  @override
  Future<List<VehicleModel>> listVehicles({String? driverProfileId}) async {
    final response = await _dio.get('/vehicles', queryParameters: {
      if (driverProfileId != null) 'driverProfileId': driverProfileId,
    });
    final List list = response.data['data'];
    return list.map((e) => VehicleModel.fromJson(e)).toList();
  }

  @override
  Future<VehicleModel> getVehicle(String id) async {
    final response = await _dio.get('/vehicles/$id');
    return VehicleModel.fromJson(response.data['data']);
  }

  @override
  Future<VehicleModel> updateVehicle(String id, Map<String, dynamic> data) async {
    final response = await _dio.patch('/vehicles/$id', data: data);
    return VehicleModel.fromJson(response.data['data']);
  }

  @override
  Future<VehicleModel> deactivateVehicle(String id) async {
    final response = await _dio.post('/vehicles/$id/deactivate');
    return VehicleModel.fromJson(response.data['data']);
  }

  @override
  Future<UserPreferencesModel> getUserPreferences(String userId) async {
    final response = await _dio.get('/users/$userId/preferences');
    return UserPreferencesModel.fromJson(response.data['data']);
  }

  @override
  Future<UserPreferencesModel> updateUserPreferences(String userId, Map<String, dynamic> data) async {
    final response = await _dio.patch('/users/$userId/preferences', data: data);
    return UserPreferencesModel.fromJson(response.data['data']);
  }

  @override
  Future<List<UserHistoryModel>> getUserHistory(String userId, {int limit = 20}) async {
    final response = await _dio.get('/users/$userId/history', queryParameters: {'limit': limit});
    final List list = response.data['data'];
    return list.map((e) => UserHistoryModel.fromJson(e)).toList();
  }
}
