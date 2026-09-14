import '../../data/models/ride_model.dart';
import '../repositories/ride_repository.dart';

class CreateRideUseCase {
  final RideRepository repository;

  CreateRideUseCase(this.repository);

  Future<RideModel> execute(Map<String, dynamic> data) {
    return repository.createRide(data);
  }
}
