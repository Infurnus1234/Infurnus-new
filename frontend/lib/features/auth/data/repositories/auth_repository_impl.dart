import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_remote_data_source.dart';
import '../models/auth_models.dart';

class AuthRepositoryImpl implements AuthRepository {
  final AuthRemoteDataSource _remoteDataSource;

  AuthRepositoryImpl(this._remoteDataSource);

  @override
  Future<SignupResponse> signup(SignupRequest request) {
    return _remoteDataSource.signup(request);
  }

  @override
  Future<AuthResponse> verifySignup(VerifySignupRequest request) {
    return _remoteDataSource.verifySignup(request);
  }

  @override
  Future<SignupResponse> resendSignupOtp(ResendSignupRequest request) {
    return _remoteDataSource.resendSignupOtp(request);
  }

  @override
  Future<LoginChallengeResponse> login(LoginRequest request) {
    return _remoteDataSource.login(request);
  }

  @override
  Future<AuthResponse> verifyLogin(VerifyLoginRequest request) {
    return _remoteDataSource.verifyLogin(request);
  }

  @override
  Future<LoginChallengeResponse> resendLoginOtp(ResendLoginRequest request) {
    return _remoteDataSource.resendLoginOtp(request);
  }

  @override
  Future<AuthResponse> refreshToken() {
    return _remoteDataSource.refreshToken();
  }

  @override
  Future<void> logout() {
    return _remoteDataSource.logout();
  }

  @override
  Future<PublicUser> getUserProfile(String userId) {
    return _remoteDataSource.getUserProfile(userId);
  }
}
