import '../../data/models/ride_model.dart';
import '../repositories/ride_repository.dart';

class ListRidesUseCase {
  final RideRepository repository;

  ListRidesUseCase(this.repository);

  Future<List<RideModel>> execute({String? status, int? limit}) {
    return repository.listRides(status: status, limit: limit);
  }
}
