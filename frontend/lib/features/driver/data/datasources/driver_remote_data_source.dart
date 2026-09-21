import 'package:dio/dio.dart';
import '../models/partner_model.dart';
import '../models/partner_document_model.dart';
import '../models/vehicle_model.dart';
import '../models/driver_profile_model.dart';
import '../models/driver_history_model.dart';
import '../models/fleet_dashboard_model.dart';
import '../models/fleet_driver_model.dart';
import '../models/fleet_earnings_model.dart';
import '../models/provider_bank_account_model.dart';
import '../models/support_ticket_model.dart';
import '../../../auth/data/models/user_preferences_model.dart';
import '../../../customer/data/models/ride_model.dart';

abstract class DriverRemoteDataSource {
  Future<PartnerModel> createPartner(Map<String, dynamic> data);
  Future<PartnerModel> getPartner(String id);
  Future<PartnerModel?> getMyPartner();
  Future<PartnerModel> updatePartner(String id, Map<String, dynamic> data);
  Future<List<PartnerDocumentModel>> listDocuments(String partnerId);
  Future<PartnerDocumentModel> addDocument(String partnerId, Map<String, dynamic> data);
  Future<PartnerDocumentModel> updateDocument(String partnerId, String documentId, Map<String, dynamic> data);
  
  Future<DriverProfileModel?> getDriverProfile();
  Future<DriverProfileModel> upsertDriverProfile(Map<String, dynamic> data);
  Future<DriverHistoryModel> getDriverHistory({int limit = 20});

  Future<void> updateAvailability(String status);
  Future<void> updateLocation(Map<String, dynamic> data);
  Future<List<RideModel>> getAvailableRides();
  Future<RideModel> acceptRide(String rideId);
  Future<RideModel> completeRide(String rideId);
  Future<RideModel> transitionRide(String rideId, String status, {String? pin});
  Future<bool> verifyPin(String rideId, String pin);

  Future<VehicleModel> createVehicle(Map<String, dynamic> data);
  Future<List<VehicleModel>> listVehicles({String? driverProfileId});
  Future<VehicleModel> getVehicle(String id);
  Future<VehicleModel> updateVehicle(String id, Map<String, dynamic> data);
  Future<VehicleModel> deactivateVehicle(String id);

  Future<UserPreferencesModel> getUserPreferences(String userId);
  Future<UserPreferencesModel> updateUserPreferences(String userId, Map<String, dynamic> data);
  Future<List<UserHistoryModel>> getUserHistory(String userId, {int limit = 20});

  // Assignment & Active Vehicle
  Future<Map<String, dynamic>> verifyAssignmentCode(String code);
  Future<Map<String, dynamic>> claimAssignmentCode(String code);
  Future<void> setActiveVehicle(String vehicleId);
  Future<VehicleModel?> getAssignedVehicle();

  // Fleet Owner
  Future<FleetDashboardModel> getFleetDashboard();
  Future<List<VehicleModel>> listFleetVehicles();
  Future<VehicleModel> createFleetVehicle(Map<String, dynamic> data);
  Future<Map<String, dynamic>> generateFleetAssignmentCode(String vehicleId);
  Future<void> unassignFleetDriver(String vehicleId);
  Future<List<FleetDriverModel>> listFleetDrivers();
  Future<List<Map<String, dynamic>>> listFleetTrips();
  Future<FleetEarningsModel> getFleetEarnings();

  // Provider Bank Details
  Future<ProviderBankAccountModel?> getProviderBankAccount();
  Future<ProviderBankAccountModel> upsertProviderBankAccount(Map<String, dynamic> data);

  // Support Tickets
  Future<SupportTicketModel> createSupportTicket(Map<String, dynamic> data);
  Future<List<SupportTicketModel>> listSupportTickets();
  Future<SupportTicketModel> getSupportTicket(String id);
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
  Future<PartnerModel?> getMyPartner() async {
    try {
      final response = await _dio.get('/partners/me');
      if (response.data['data'] != null) {
        return PartnerModel.fromJson(response.data['data']);
      }
      return null;
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  @override
  Future<DriverProfileModel?> getDriverProfile() async {
    try {
      final response = await _dio.get('/rides/driver/profile');
      if (response.data['data'] != null) {
        return DriverProfileModel.fromJson(response.data['data']);
      }
      return null;
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  @override
  Future<DriverProfileModel> upsertDriverProfile(Map<String, dynamic> data) async {
    final response = await _dio.post('/rides/driver/profile', data: data);
    return DriverProfileModel.fromJson(response.data['data']);
  }

  @override
  Future<DriverHistoryModel> getDriverHistory({int limit = 20}) async {
    final response = await _dio.get('/rides/driver/history', queryParameters: {'limit': limit});
    return DriverHistoryModel.fromJson(response.data['data']);
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
  Future<List<RideModel>> getAvailableRides() async {
    final response = await _dio.get('/rides/driver/available');
    final List list = response.data['data'] ?? [];
    return list.map((e) => RideModel.fromJson(e as Map<String, dynamic>)).toList();
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
  Future<RideModel> transitionRide(String rideId, String status, {String? pin}) async {
    final response = await _dio.post(
      '/rides/$rideId/status',
      data: {
        'status': status,
        if (pin != null) 'pin': pin,
      },
    );
    return RideModel.fromJson(response.data['data']);
  }

  @override
  Future<bool> verifyPin(String rideId, String pin) async {
    final response = await _dio.post(
      '/rides/$rideId/verify-pin',
      data: {'pin': pin},
    );
    return response.data['success'] == true;
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

  // ==========================================
  // Assignment & Active Vehicle
  // ==========================================

  @override
  Future<Map<String, dynamic>> verifyAssignmentCode(String code) async {
    final response = await _dio.post('/rides/driver/assignment/verify-code', data: {'code': code});
    return Map<String, dynamic>.from(response.data['data']);
  }

  @override
  Future<Map<String, dynamic>> claimAssignmentCode(String code) async {
    final response = await _dio.post('/rides/driver/assignment/claim-code', data: {'code': code});
    return Map<String, dynamic>.from(response.data['data']);
  }

  @override
  Future<void> setActiveVehicle(String vehicleId) async {
    await _dio.post('/rides/driver/active-vehicle', data: {'vehicleId': vehicleId});
  }

  @override
  Future<VehicleModel?> getAssignedVehicle() async {
    try {
      final response = await _dio.get('/rides/driver/assigned-vehicle');
      if (response.data['data'] != null) {
        return VehicleModel.fromJson(response.data['data']);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // ==========================================
  // Fleet Owner
  // ==========================================

  @override
  Future<FleetDashboardModel> getFleetDashboard() async {
    final response = await _dio.get('/fleet/dashboard');
    return FleetDashboardModel.fromJson(response.data['data']);
  }

  @override
  Future<List<VehicleModel>> listFleetVehicles() async {
    final response = await _dio.get('/fleet/vehicles');
    final List list = response.data['data'] ?? [];
    return list.map((e) => VehicleModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  @override
  Future<VehicleModel> createFleetVehicle(Map<String, dynamic> data) async {
    final response = await _dio.post('/fleet/vehicles', data: data);
    return VehicleModel.fromJson(response.data['data']);
  }

  @override
  Future<Map<String, dynamic>> generateFleetAssignmentCode(String vehicleId) async {
    final response = await _dio.post('/fleet/vehicles/$vehicleId/assignment-code');
    return Map<String, dynamic>.from(response.data['data']);
  }

  @override
  Future<void> unassignFleetDriver(String vehicleId) async {
    await _dio.post('/fleet/vehicles/$vehicleId/unassign');
  }

  @override
  Future<List<FleetDriverModel>> listFleetDrivers() async {
    final response = await _dio.get('/fleet/drivers');
    final List list = response.data['data'] ?? [];
    return list.map((e) => FleetDriverModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  @override
  Future<List<Map<String, dynamic>>> listFleetTrips() async {
    final response = await _dio.get('/fleet/trips');
    final List list = response.data['data'] ?? [];
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  @override
  Future<FleetEarningsModel> getFleetEarnings() async {
    final response = await _dio.get('/fleet/earnings');
    return FleetEarningsModel.fromJson(response.data['data']);
  }

  // ==========================================
  // Provider Bank Details
  // ==========================================

  @override
  Future<ProviderBankAccountModel?> getProviderBankAccount() async {
    try {
      final response = await _dio.get('/provider/bank-account');
      if (response.data['data'] != null) {
        return ProviderBankAccountModel.fromJson(response.data['data']);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<ProviderBankAccountModel> upsertProviderBankAccount(Map<String, dynamic> data) async {
    final response = await _dio.post('/provider/bank-account', data: data);
    return ProviderBankAccountModel.fromJson(response.data['data']);
  }

  // ==========================================
  // Support Tickets
  // ==========================================

  @override
  Future<SupportTicketModel> createSupportTicket(Map<String, dynamic> data) async {
    final response = await _dio.post('/support/tickets', data: data);
    return SupportTicketModel.fromJson(response.data['data']);
  }

  @override
  Future<List<SupportTicketModel>> listSupportTickets() async {
    final response = await _dio.get('/support/tickets');
    final List list = response.data['data'] ?? [];
    return list.map((e) => SupportTicketModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  @override
  Future<SupportTicketModel> getSupportTicket(String id) async {
    final response = await _dio.get('/support/tickets/$id');
    return SupportTicketModel.fromJson(response.data['data']);
  }
}
