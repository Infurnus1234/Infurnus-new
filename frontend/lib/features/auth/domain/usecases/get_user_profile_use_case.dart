import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class GetUserProfileUseCase {
  final AuthRepository repository;

  GetUserProfileUseCase(this.repository);

  Future<PublicUser> execute(String userId) {
    return repository.getUserProfile(userId);
  }
}
