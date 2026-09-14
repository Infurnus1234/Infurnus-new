import '../repositories/driver_repository.dart';
import '../../../customer/data/models/ride_model.dart';

class AcceptRideUseCase {
  final DriverRepository repository;

  AcceptRideUseCase(this.repository);

  Future<RideModel> execute(String rideId) {
    return repository.acceptRide(rideId);
  }
}
