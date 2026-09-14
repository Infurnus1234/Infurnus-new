import '../../data/models/partner_model.dart';
import '../../data/models/partner_document_model.dart';
import '../../data/models/vehicle_model.dart';
import '../../../customer/data/models/ride_model.dart';

abstract class DriverRepository {
  Future<PartnerModel> createPartner(Map<String, dynamic> data);
  Future<PartnerModel> getPartner(String id);
  Future<PartnerModel> updatePartner(String id, Map<String, dynamic> data);
  Future<List<PartnerDocumentModel>> listDocuments(String partnerId);
  Future<PartnerDocumentModel> addDocument(String partnerId, Map<String, dynamic> data);
  
  Future<void> updateAvailability(String status);
  Future<void> updateLocation(Map<String, dynamic> data);
  Future<RideModel> acceptRide(String rideId);
  Future<RideModel> completeRide(String rideId);
  Future<RideModel> transitionRide(String rideId, String status);

  Future<VehicleModel> createVehicle(Map<String, dynamic> data);
  Future<List<VehicleModel>> listVehicles({String? driverProfileId});
  Future<VehicleModel> getVehicle(String id);
}
