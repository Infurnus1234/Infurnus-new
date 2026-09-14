import '../repositories/driver_repository.dart';
import '../../../customer/data/models/ride_model.dart';

class CompleteRideUseCase {
  final DriverRepository repository;

  CompleteRideUseCase(this.repository);

  Future<RideModel> execute(String rideId) {
    return repository.completeRide(rideId);
  }
}
