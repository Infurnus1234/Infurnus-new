import '../repositories/driver_repository.dart';
import '../../../auth/data/models/user_preferences_model.dart';

class GetUserHistoryUseCase {
  final DriverRepository repository;

  GetUserHistoryUseCase(this.repository);

  Future<List<UserHistoryModel>> execute(String userId, {int limit = 20}) {
    return repository.getUserHistory(userId, limit: limit);
  }
}
