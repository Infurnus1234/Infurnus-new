import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class LoginUseCase {
  final AuthRepository repository;

  LoginUseCase(this.repository);

  Future<LoginChallengeResponse> execute(LoginRequest request, [String channel = 'phone']) {
    if (channel == 'email') {
      return repository.loginEmail(request);
    }
    return repository.login(request);
  }
}
