import '../../data/models/auth_models.dart';

abstract class AuthRepository {
  Future<SignupResponse> signup(SignupRequest request);
  Future<AuthResponse> verifySignup(VerifySignupRequest request);
  Future<SignupResponse> resendSignupOtp(ResendSignupRequest request);
  Future<LoginChallengeResponse> login(LoginRequest request);
  Future<LoginChallengeResponse> loginEmail(LoginRequest request);
  Future<AuthResponse> verifyLogin(VerifyLoginRequest request);
  Future<AuthResponse> verifyLoginEmail(VerifyLoginRequest request);
  Future<LoginChallengeResponse> resendLoginOtp(ResendLoginRequest request);
  Future<LoginChallengeResponse> resendLoginEmailOtp(ResendLoginRequest request);
  Future<AuthResponse> refreshToken();
  Future<void> logout();
  Future<PublicUser> getUserProfile(String userId);
}
