import '../../data/models/driver_history_model.dart';
import '../repositories/driver_repository.dart';

class GetDriverHistoryUseCase {
  final DriverRepository repository;

  GetDriverHistoryUseCase(this.repository);

  Future<DriverHistoryModel> execute({int limit = 20}) {
    return repository.getDriverHistory(limit: limit);
  }
}
