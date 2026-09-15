import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class ResendLoginOtpUseCase {
  final AuthRepository repository;

  ResendLoginOtpUseCase(this.repository);

  Future<LoginChallengeResponse> execute(ResendLoginRequest request) {
    return repository.resendLoginOtp(request);
  }
}
