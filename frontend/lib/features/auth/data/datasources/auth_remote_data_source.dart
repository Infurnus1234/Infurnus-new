import 'package:dio/dio.dart';
import '../models/auth_models.dart';

abstract class AuthRemoteDataSource {
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

class AuthRemoteDataSourceImpl implements AuthRemoteDataSource {
  final Dio _dio;

  AuthRemoteDataSourceImpl(this._dio);

  @override
  Future<SignupResponse> signup(SignupRequest request) async {
    final response = await _dio.post('/auth/signup', data: request.toJson());
    return SignupResponse.fromJson(response.data['data']);
  }

  @override
  Future<AuthResponse> verifySignup(VerifySignupRequest request) async {
    final response = await _dio.post('/auth/signup/verify', data: request.toJson());
    return AuthResponse.fromJson(response.data['data']);
  }

  @override
  Future<SignupResponse> resendSignupOtp(ResendSignupRequest request) async {
    final response = await _dio.post('/auth/signup/resend', data: request.toJson());
    return SignupResponse.fromJson(response.data['data']);
  }

  @override
  Future<LoginChallengeResponse> login(LoginRequest request) async {
    final response = await _dio.post('/auth/login', data: request.toJson());
    return LoginChallengeResponse.fromJson(response.data['data']);
  }

  @override
  Future<LoginChallengeResponse> loginEmail(LoginRequest request) async {
    final response = await _dio.post('/auth/login', data: request.toJson());
    return LoginChallengeResponse.fromJson(response.data['data']);
  }

  @override
  Future<AuthResponse> verifyLogin(VerifyLoginRequest request) async {
    final response = await _dio.post('/auth/login/verify', data: request.toJson());
    return AuthResponse.fromJson(response.data['data']);
  }

  @override
  Future<AuthResponse> verifyLoginEmail(VerifyLoginRequest request) async {
    final response = await _dio.post('/auth/login/verify', data: request.toJson());
    return AuthResponse.fromJson(response.data['data']);
  }

  @override
  Future<LoginChallengeResponse> resendLoginOtp(ResendLoginRequest request) async {
    final response = await _dio.post('/auth/login/resend', data: request.toJson());
    return LoginChallengeResponse.fromJson(response.data['data']);
  }

  @override
  Future<LoginChallengeResponse> resendLoginEmailOtp(ResendLoginRequest request) async {
    final response = await _dio.post('/auth/login/resend', data: request.toJson());
    return LoginChallengeResponse.fromJson(response.data['data']);
  }

  @override
  Future<AuthResponse> refreshToken() async {
    final response = await _dio.post('/auth/refresh');
    return AuthResponse.fromJson(response.data['data']);
  }

  @override
  Future<void> logout() async {
    await _dio.post('/auth/logout');
  }

  @override
  Future<PublicUser> getUserProfile(String userId) async {
    final response = await _dio.get('/users/$userId');
    return PublicUser.fromJson(response.data['data']);
  }
}
