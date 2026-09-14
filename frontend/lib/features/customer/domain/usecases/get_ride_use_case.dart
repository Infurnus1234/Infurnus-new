import '../../data/models/ride_model.dart';
import '../repositories/ride_repository.dart';

class GetRideUseCase {
  final RideRepository repository;

  GetRideUseCase(this.repository);

  Future<RideModel> execute(String id) {
    return repository.getRide(id);
  }
}
