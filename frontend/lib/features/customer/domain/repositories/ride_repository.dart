import '../../data/models/ride_model.dart';

abstract class RideRepository {
  Future<RideModel> createRide(Map<String, dynamic> data);
  Future<List<RideModel>> listRides({String? status, int? limit});
  Future<RideModel> getRide(String id);
  Future<RideModel> cancelRide(String id, String reason);
}
