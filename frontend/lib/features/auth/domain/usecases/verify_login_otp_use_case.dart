import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class VerifyLoginOtpUseCase {
  final AuthRepository repository;

  VerifyLoginOtpUseCase(this.repository);

  Future<AuthResponse> execute(VerifyLoginRequest request) {
    return repository.verifyLogin(request);
  }
}
