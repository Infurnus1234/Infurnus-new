import '../repositories/driver_repository.dart';
import '../../../auth/data/models/user_preferences_model.dart';

class GetUserPreferencesUseCase {
  final DriverRepository repository;

  GetUserPreferencesUseCase(this.repository);

  Future<UserPreferencesModel> execute(String userId) {
    return repository.getUserPreferences(userId);
  }
}
