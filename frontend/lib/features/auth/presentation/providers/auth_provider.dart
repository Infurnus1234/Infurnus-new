import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/socket_service.dart';
import '../../../../core/network/dio_client.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../data/models/auth_models.dart';
import 'auth_use_case_providers.dart';
import 'user_provider.dart';

enum AuthStatus {
  initial,
  authenticated,
  unauthenticated,
  loading,
  otpRequired,
}

const _unchanged = Object();

class AuthState {
  final AuthStatus status;
  final String? errorMessage;
  final String? signupId;
  final String? loginChallengeId;
  final String loginChannel; // 'phone' or 'email'
  final String? contactValue;

  AuthState({
    required this.status,
    this.errorMessage,
    this.signupId,
    this.loginChallengeId,
    this.loginChannel = 'phone',
    this.contactValue,
  });

  AuthState copyWith({
    AuthStatus? status,
    Object? errorMessage = _unchanged,
    Object? signupId = _unchanged,
    Object? loginChallengeId = _unchanged,
    String? loginChannel,
    Object? contactValue = _unchanged,
  }) {
    return AuthState(
      status: status ?? this.status,
      errorMessage: identical(errorMessage, _unchanged)
          ? this.errorMessage
          : errorMessage as String?,
      signupId: identical(signupId, _unchanged)
          ? this.signupId
          : signupId as String?,
      loginChallengeId: identical(loginChallengeId, _unchanged)
          ? this.loginChallengeId
          : loginChallengeId as String?,
      loginChannel: loginChannel ?? this.loginChannel,
      contactValue: identical(contactValue, _unchanged)
          ? this.contactValue
          : contactValue as String?,
    );
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  final Ref ref;
  bool _isProcessing = false;

  AuthNotifier(this.ref) : super(AuthState(status: AuthStatus.initial)) {
    checkAuthStatus();
  }

  Future<void> checkAuthStatus() async {
    if (_isProcessing) return;
    _isProcessing = true;
    debugPrint('AuthNotifier: Checking auth status...');
    try {
      final token = await ref
          .read(secureStorageProvider)
          .read(key: 'auth_token')
          .timeout(
            const Duration(seconds: 3),
            onTimeout: () {
              debugPrint('AuthNotifier: token read timeout');
              return null;
            },
          );
      final userId = await ref
          .read(secureStorageProvider)
          .read(key: 'user_id')
          .timeout(
            const Duration(seconds: 3),
            onTimeout: () {
              debugPrint('AuthNotifier: userId read timeout');
              return null;
            },
          );

      debugPrint(
        'AuthNotifier: token: ${token != null ? "found" : "null"}, userId: $userId',
      );

      if (token != null && userId != null) {
        try {
          debugPrint('AuthNotifier: Fetching user profile for $userId');
          final publicUser = await ref
              .read(getUserProfileUseCaseProvider)
              .execute(userId)
              .timeout(const Duration(seconds: 7));
          final currentToken = await ref
              .read(secureStorageProvider)
              .read(key: 'auth_token');
          final role = authRoleFromToken(currentToken ?? token);
          await ref
              .read(secureStorageProvider)
              .write(key: 'user_role', value: role);
          debugPrint(
            'AuthNotifier: Profile fetched, role: $role. Authenticating...',
          );
          ref.read(userProvider.notifier).setUser(publicUser.toEntity(role));
          ref.read(socketServiceProvider).connect(token);
          state = state.copyWith(status: AuthStatus.authenticated);
          debugPrint('AuthNotifier: Authenticated successfully');
        } catch (e) {
          debugPrint(
            'AuthNotifier: Profile fetch failed: $e. Reverting to unauthenticated.',
          );
          state = state.copyWith(status: AuthStatus.unauthenticated);
        }
      } else {
        debugPrint('AuthNotifier: No session found. Unauthenticated.');
        state = state.copyWith(status: AuthStatus.unauthenticated);
      }
    } catch (e) {
      debugPrint('AuthNotifier: Fatal error in checkAuthStatus: $e');
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        errorMessage: e.toString(),
      );
    } finally {
      _isProcessing = false;
    }
  }

  Future<void> signup(SignupRequest request) async {
    if (_isProcessing) {
      debugPrint('[AUTH] Signup BLOCKED - already processing');
      return;
    }
    _isProcessing = true;
    state = state.copyWith(
      status: AuthStatus.loading,
      contactValue: request.phone ?? request.email,
      loginChallengeId: null,
      errorMessage: null,
    );
    try {
      final response = await ref.read(signupUseCaseProvider).execute(request);
      state = state.copyWith(
        status: AuthStatus.otpRequired,
        signupId: response.signupId,
        loginChannel: response.contactType,
      );
    } catch (e) {
      final message = _parseError(e);
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        errorMessage: message,
      );
    } finally {
      _isProcessing = false;
    }
  }

  Future<void> verifyOtp(String otp) async {
    if (_isProcessing) {
      debugPrint('[AUTH] OTP Verify BLOCKED - already processing');
      return;
    }
    _isProcessing = true;
    if (state.signupId != null) {
      state = state.copyWith(status: AuthStatus.loading);
      try {
        final request = VerifySignupRequest(
          signupId: state.signupId!,
          otp: otp,
        );
        final response = await ref
            .read(verifySignupOtpUseCaseProvider)
            .execute(request);
        await _handleAuthSuccess(response);
      } catch (e) {
        final message = _parseError(e);
        state = state.copyWith(
          status: AuthStatus.otpRequired,
          errorMessage: message,
        );
      } finally {
        _isProcessing = false;
      }
    } else if (state.loginChallengeId != null) {
      state = state.copyWith(status: AuthStatus.loading);
      try {
        final request = VerifyLoginRequest(
          challengeId: state.loginChallengeId!,
          otp: otp,
        );
        final response = await ref
            .read(verifyLoginOtpUseCaseProvider)
            .execute(request, state.loginChannel);
        await _handleAuthSuccess(response);
      } catch (e) {
        final message = _parseError(e);
        state = state.copyWith(
          status: AuthStatus.otpRequired,
          errorMessage: message,
        );
      } finally {
        _isProcessing = false;
      }
    } else {
      _isProcessing = false;
    }
  }

  Future<void> login(LoginRequest request, [String channel = 'phone']) async {
    if (_isProcessing) {
      return;
    }
    _isProcessing = true;

    state = state.copyWith(
      status: AuthStatus.loading,
      loginChannel: channel,
      contactValue: channel == 'email' ? request.email : request.phone,
      signupId: null,
      errorMessage: null,
    );
    try {
      final response = await ref
          .read(loginUseCaseProvider)
          .execute(request, channel);
      state = state.copyWith(
        status: AuthStatus.otpRequired,
        loginChallengeId: response.challengeId,
      );
    } catch (e) {
      final message = _parseError(e);
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        errorMessage: message,
      );
    } finally {
      _isProcessing = false;
    }
  }

  Future<void> signInWithGoogle(String idToken) async {
    if (_isProcessing) return;
    _isProcessing = true;
    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);
    var stage = 'API request';
    try {
      final response = await ref
          .read(dioProvider)
          .post(
            '/auth/google',
            data: {'idToken': idToken},
            options: Options(extra: {'withCredentials': true}),
          );
      debugPrint('Google auth: API HTTP ${response.statusCode}');
      stage = 'session/profile';
      await _handleAuthSuccess(AuthResponse.fromJson(response.data['data']));
      debugPrint('Google auth: existing session established');
    } catch (error) {
      debugPrint(
        'Google auth: failure during $stage; type=${error.runtimeType}',
      );
      String message = 'Google sign-in could not be completed.';
      if (error is DioException) {
        debugPrint(
          'Google auth: HTTP ${error.response?.statusCode}; transport=${error.type.name}',
        );
        final body = error.response?.data;
        if (body is Map &&
            body['error'] is Map &&
            body['error']['message'] is String) {
          message = body['error']['message'] as String;
        }
      }
      if (error is DioException &&
          error.type == DioExceptionType.connectionError) {
        message = 'Google returned an ID token, but the API request failed. Check the local server and allowed browser origin.';
      }
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        errorMessage: message,
      );
    } finally {
      _isProcessing = false;
    }
  }

  String _parseError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['error'] is Map) {
        final message = (data['error'] as Map)['message'];
        if (message is String && message.isNotEmpty) return message;
      }
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        return 'Connection timed out. Please check your internet or firewall settings.';
      }
      if (e.type == DioExceptionType.connectionError) {
        return 'Connection error. The server might be unreachable.';
      }
      return e.message ?? e.toString();
    }
    return e.toString();
  }

  Future<void> resendOtp() async {
    state = state.copyWith(errorMessage: null);
    if (state.signupId != null) {
      try {
        final request = ResendSignupRequest(signupId: state.signupId!);
        await ref.read(resendSignupOtpUseCaseProvider).execute(request);
      } catch (e) {
        state = state.copyWith(errorMessage: _parseError(e));
      }
    } else if (state.loginChallengeId != null) {
      try {
        final request = ResendLoginRequest(
          challengeId: state.loginChallengeId!,
        );
        await ref
            .read(resendLoginOtpUseCaseProvider)
            .execute(request, state.loginChannel);
      } catch (e) {
        state = state.copyWith(errorMessage: _parseError(e));
      }
    }
  }

  Future<void> _handleAuthSuccess(AuthResponse response) async {
    final role = authRoleFromToken(response.accessToken);
    await ref
        .read(secureStorageProvider)
        .write(key: 'auth_token', value: response.accessToken);
    await ref
        .read(secureStorageProvider)
        .write(key: 'user_id', value: response.userId);

    final publicUser = await ref
        .read(getUserProfileUseCaseProvider)
        .execute(response.userId);

    await ref.read(secureStorageProvider).write(key: 'user_role', value: role);

    ref.read(userProvider.notifier).setUser(publicUser.toEntity(role));
    ref.read(socketServiceProvider).connect(response.accessToken);
    state = state.copyWith(status: AuthStatus.authenticated);
  }

  Future<void> logout() async {
    String? logoutError;
    try {
      await ref.read(logoutUseCaseProvider).execute();
    } catch (_) {
      logoutError =
          'Signed out locally; the server session could not be revoked.';
    } finally {
      await ref.read(secureStorageProvider).delete(key: 'auth_token');
      await ref.read(secureStorageProvider).delete(key: 'user_id');
      await ref.read(secureStorageProvider).delete(key: 'user_role');
      await ref.read(secureStorageProvider).delete(key: 'auth_csrf_token');
      ref.read(socketServiceProvider).disconnect();
      ref.read(userProvider.notifier).logout();
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: logoutError,
      );
    }
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
