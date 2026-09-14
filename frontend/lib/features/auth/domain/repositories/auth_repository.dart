import '../../data/models/auth_models.dart';

abstract class AuthRepository {
  Future<SignupResponse> signup(SignupRequest request);
  Future<AuthResponse> verifySignup(VerifySignupRequest request);
  Future<SignupResponse> resendSignupOtp(ResendSignupRequest request);
  Future<AuthResponse> login(LoginRequest request);
  Future<AuthResponse> refreshToken();
  Future<void> logout();
  Future<PublicUser> getUserProfile(String userId);
}
