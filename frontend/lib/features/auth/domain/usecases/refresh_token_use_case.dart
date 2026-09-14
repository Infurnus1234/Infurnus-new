import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class RefreshTokenUseCase {
  final AuthRepository repository;

  RefreshTokenUseCase(this.repository);

  Future<AuthResponse> execute() {
    return repository.refreshToken();
  }
}
