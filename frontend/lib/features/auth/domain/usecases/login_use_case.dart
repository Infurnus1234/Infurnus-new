import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class LoginUseCase {
  final AuthRepository repository;

  LoginUseCase(this.repository);

  Future<AuthResponse> execute(LoginRequest request) {
    return repository.login(request);
  }
}
