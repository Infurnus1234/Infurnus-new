import '../../data/models/ride_model.dart';
import '../repositories/ride_repository.dart';

class CancelRideUseCase {
  final RideRepository repository;

  CancelRideUseCase(this.repository);

  Future<RideModel> execute(String id, String reason) {
    return repository.cancelRide(id, reason);
  }
}
