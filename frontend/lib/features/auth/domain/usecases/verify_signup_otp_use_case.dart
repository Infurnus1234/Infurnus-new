import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class VerifySignupOtpUseCase {
  final AuthRepository repository;

  VerifySignupOtpUseCase(this.repository);

  Future<AuthResponse> execute(VerifySignupRequest request) {
    return repository.verifySignup(request);
  }
}
