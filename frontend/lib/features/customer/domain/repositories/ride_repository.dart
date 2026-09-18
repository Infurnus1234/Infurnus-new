import '../../data/models/fare_estimate_model.dart';
import '../../data/models/fleet_vehicle_model.dart';
import '../../data/models/ride_model.dart';

abstract class RideRepository {
  Future<RideModel> createRide(Map<String, dynamic> data);
  Future<List<RideModel>> listRides({String? status, int? limit});
  Future<RideModel> getRide(String id);
  Future<RideModel> cancelRide(String id, String reason);
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data);
  Future<Map<String, dynamic>> submitRating({
    required String rideId,
    required int rating,
    String? review,
  });
  Future<Map<String, dynamic>> initiatePayment({
    required String rideId,
    required double amount,
    required String paymentMethod,
  });
  Future<List<Map<String, dynamic>>> listPayments({int? limit});
  Future<List<FleetVehicleModel>> getFleet({String? sector, String? category});
}
