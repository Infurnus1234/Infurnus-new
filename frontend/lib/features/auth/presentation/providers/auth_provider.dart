import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/services/socket_service.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../data/models/auth_models.dart';
import 'auth_use_case_providers.dart';
import 'user_provider.dart';

enum AuthStatus { initial, authenticated, unauthenticated, loading, otpRequired }

class AuthState {
  final AuthStatus status;
  final String? errorMessage;
  final String? signupId;
  final String? loginChallengeId;

  AuthState({
    required this.status,
    this.errorMessage,
    this.signupId,
    this.loginChallengeId,
  });

  AuthState copyWith({
    AuthStatus? status,
    String? errorMessage,
    String? signupId,
    String? loginChallengeId,
  }) {
    return AuthState(
      status: status ?? this.status,
      errorMessage: errorMessage ?? this.errorMessage,
      signupId: signupId ?? this.signupId,
      loginChallengeId: loginChallengeId ?? this.loginChallengeId,
    );
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  final Ref ref;

  AuthNotifier(this.ref) : super(AuthState(status: AuthStatus.initial)) {
    checkAuthStatus();
  }

  Future<void> checkAuthStatus() async {
    debugPrint('AuthNotifier: Checking auth status...');
    try {
      final token = await ref.read(secureStorageProvider).read(key: 'auth_token').timeout(
        const Duration(seconds: 3),
        onTimeout: () {
          debugPrint('AuthNotifier: token read timeout');
          return null;
        },
      );
      final userId = await ref.read(secureStorageProvider).read(key: 'user_id').timeout(
        const Duration(seconds: 3),
        onTimeout: () {
          debugPrint('AuthNotifier: userId read timeout');
          return null;
        },
      );
      
      debugPrint('AuthNotifier: token: ${token != null ? "found" : "null"}, userId: $userId');

      if (token != null && userId != null) {
        try {
          debugPrint('AuthNotifier: Fetching user profile for $userId');
          final publicUser = await ref.read(getUserProfileUseCaseProvider).execute(userId).timeout(
            const Duration(seconds: 7),
          );
          final role = await ref.read(secureStorageProvider).read(key: 'user_role').timeout(
            const Duration(seconds: 3),
            onTimeout: () => 'customer',
          ) ?? 'customer';
          
          debugPrint('AuthNotifier: Profile fetched, role: $role. Authenticating...');
          ref.read(userProvider.notifier).setUser(publicUser.toEntity(role));
          ref.read(socketServiceProvider).connect(token);
          state = state.copyWith(status: AuthStatus.authenticated);
          debugPrint('AuthNotifier: Authenticated successfully');
        } catch (e) {
          debugPrint('AuthNotifier: Profile fetch failed: $e. Reverting to unauthenticated.');
          state = state.copyWith(status: AuthStatus.unauthenticated);
        }
      } else {
        debugPrint('AuthNotifier: No session found. Unauthenticated.');
        state = state.copyWith(status: AuthStatus.unauthenticated);
      }
    } catch (e) {
      debugPrint('AuthNotifier: Fatal error in checkAuthStatus: $e');
      state = state.copyWith(status: AuthStatus.unauthenticated, errorMessage: e.toString());
    }
  }

  Future<void> signup(SignupRequest request) async {
    state = state.copyWith(status: AuthStatus.loading);
    try {
      final response = await ref.read(signupUseCaseProvider).execute(request);
      state = state.copyWith(
        status: AuthStatus.otpRequired,
        signupId: response.signupId,
      );
    } catch (e) {
      final message = _parseError(e);
      state = state.copyWith(status: AuthStatus.unauthenticated, errorMessage: message);
    }
  }

  Future<void> verifyOtp(String otp) async {
    if (state.signupId != null) {
      state = state.copyWith(status: AuthStatus.loading);
      try {
        final request = VerifySignupRequest(signupId: state.signupId!, otp: otp);
        final response = await ref.read(verifySignupOtpUseCaseProvider).execute(request);
        await _handleAuthSuccess(response);
      } catch (e) {
        final message = _parseError(e);
        state = state.copyWith(status: AuthStatus.otpRequired, errorMessage: message);
      }
    } else if (state.loginChallengeId != null) {
      state = state.copyWith(status: AuthStatus.loading);
      try {
        final request = VerifyLoginRequest(challengeId: state.loginChallengeId!, otp: otp);
        final response = await ref.read(verifyLoginOtpUseCaseProvider).execute(request);
        await _handleAuthSuccess(response);
      } catch (e) {
        final message = _parseError(e);
        state = state.copyWith(status: AuthStatus.otpRequired, errorMessage: message);
      }
    }
  }

  Future<void> login(LoginRequest request) async {
    state = state.copyWith(status: AuthStatus.loading);
    try {
      final response = await ref.read(loginUseCaseProvider).execute(request);
      state = state.copyWith(
        status: AuthStatus.otpRequired,
        loginChallengeId: response.challengeId,
      );
    } catch (e) {
      final message = _parseError(e);
      state = state.copyWith(status: AuthStatus.unauthenticated, errorMessage: message);
    }
  }

  String _parseError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['error'] != null) {
        return data['error']['message'] ?? 'An error occurred';
      }
      return e.message ?? e.toString();
    }
    return e.toString();
  }

  Future<void> resendOtp() async {
    if (state.signupId != null) {
      try {
        final request = ResendSignupRequest(signupId: state.signupId!);
        await ref.read(resendSignupOtpUseCaseProvider).execute(request);
      } catch (e) {
        state = state.copyWith(errorMessage: e.toString());
      }
    } else if (state.loginChallengeId != null) {
      try {
        final request = ResendLoginRequest(challengeId: state.loginChallengeId!);
        await ref.read(resendLoginOtpUseCaseProvider).execute(request);
      } catch (e) {
        state = state.copyWith(errorMessage: e.toString());
      }
    }
  }

  Future<void> _handleAuthSuccess(AuthResponse response) async {
    await ref.read(secureStorageProvider).write(key: 'auth_token', value: response.accessToken);
    await ref.read(secureStorageProvider).write(key: 'user_id', value: response.userId);
    
    final publicUser = await ref.read(getUserProfileUseCaseProvider).execute(response.userId);
    
    const role = 'customer';
    await ref.read(secureStorageProvider).write(key: 'user_role', value: role);

    ref.read(userProvider.notifier).setUser(publicUser.toEntity(role));
    ref.read(socketServiceProvider).connect(response.accessToken);
    state = state.copyWith(status: AuthStatus.authenticated);
  }

  Future<void> logout() async {
    try {
      await ref.read(logoutUseCaseProvider).execute();
    } catch (_) {} finally {
      await ref.read(secureStorageProvider).delete(key: 'auth_token');
      await ref.read(secureStorageProvider).delete(key: 'user_id');
      await ref.read(secureStorageProvider).delete(key: 'user_role');
      ref.read(socketServiceProvider).disconnect();
      ref.read(userProvider.notifier).logout();
      state = state.copyWith(status: AuthStatus.unauthenticated, signupId: null);
    }
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
