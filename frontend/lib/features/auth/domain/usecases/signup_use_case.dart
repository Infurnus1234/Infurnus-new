import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class SignupUseCase {
  final AuthRepository repository;

  SignupUseCase(this.repository);

  Future<SignupResponse> execute(SignupRequest request) {
    return repository.signup(request);
  }
}
