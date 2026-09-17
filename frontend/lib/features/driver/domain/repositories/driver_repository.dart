import '../../data/models/partner_model.dart';
import '../../data/models/partner_document_model.dart';
import '../../data/models/vehicle_model.dart';
import '../../data/models/driver_profile_model.dart';
import '../../data/models/driver_history_model.dart';
import '../../../auth/data/models/user_preferences_model.dart';
import '../../../customer/data/models/ride_model.dart';

abstract class DriverRepository {
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
