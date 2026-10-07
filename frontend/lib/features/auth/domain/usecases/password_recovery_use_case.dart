import '../../data/models/auth_models.dart';
import '../repositories/auth_repository.dart';

class PasswordRecoveryUseCase {
  final AuthRepository repository;
  PasswordRecoveryUseCase(this.repository);
  Future<PasswordRecoverySession> send(String email) =>
      repository.forgotPassword(email);
  Future<PasswordRecoverySession> verify(String token, String otp) =>
      repository.verifyPasswordResetOtp(token, otp);
  Future<void> reset(String token, String password, String confirmation) =>
      repository.resetPassword(token, password, confirmation);
}
