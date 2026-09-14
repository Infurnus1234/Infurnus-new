import 'package:dio/dio.dart';
import '../models/auth_models.dart';

abstract class AuthRemoteDataSource {
  Future<SignupResponse> signup(SignupRequest request);
  Future<AuthResponse> verifySignup(VerifySignupRequest request);
  Future<SignupResponse> resendSignupOtp(ResendSignupRequest request);
  Future<AuthResponse> login(LoginRequest request);
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
    // Assuming backend returns { success: true, data: { signupId, ... } }
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
  Future<AuthResponse> login(LoginRequest request) async {
    final response = await _dio.post('/auth/login', data: request.toJson());
    return AuthResponse.fromJson(response.data['data']);
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
