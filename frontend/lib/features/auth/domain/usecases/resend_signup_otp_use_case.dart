import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class ResendSignupOtpUseCase {
  final AuthRepository repository;

  ResendSignupOtpUseCase(this.repository);

  Future<SignupResponse> execute(ResendSignupRequest request) {
    return repository.resendSignupOtp(request);
  }
}
