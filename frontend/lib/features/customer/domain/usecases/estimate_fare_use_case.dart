import '../../data/models/fare_estimate_model.dart';
import '../repositories/ride_repository.dart';

class EstimateFareUseCase {
  final RideRepository repository;

  EstimateFareUseCase(this.repository);

  Future<FareEstimateModel> execute(Map<String, dynamic> data) {
    return repository.estimateFare(data);
  }
}
