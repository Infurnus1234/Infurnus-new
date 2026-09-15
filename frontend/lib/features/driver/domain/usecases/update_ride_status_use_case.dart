import '../repositories/driver_repository.dart';
import '../../../customer/data/models/ride_model.dart';

class UpdateRideStatusUseCase {
  final DriverRepository repository;

  UpdateRideStatusUseCase(this.repository);

  Future<RideModel> execute(String rideId, String status) {
    return repository.transitionRide(rideId, status);
  }
}
