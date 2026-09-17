import '../repositories/driver_repository.dart';
import '../../../auth/data/models/user_preferences_model.dart';

class UpdateUserPreferencesUseCase {
  final DriverRepository repository;

  UpdateUserPreferencesUseCase(this.repository);

  Future<UserPreferencesModel> execute(String userId, Map<String, dynamic> data) {
    return repository.updateUserPreferences(userId, data);
  }
}
