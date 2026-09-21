import '../../../customer/data/models/ride_model.dart';
import '../repositories/driver_repository.dart';

class GetAvailableRidesUseCase {
  final DriverRepository repository;

  GetAvailableRidesUseCase(this.repository);

  Future<List<RideModel>> execute() {
    return repository.getAvailableRides();
  }
}
