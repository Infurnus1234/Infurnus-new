import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/services/socket_service.dart';
import '../../../../core/services/notification_service.dart';
import '../../../../core/network/dio_client.dart';
import '../../../../core/network/session_events.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../data/models/auth_models.dart';
import 'auth_use_case_providers.dart';
import 'user_provider.dart';

enum AuthStatus {
  initial,
  restoring,
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
  int _sessionGeneration = 0;

  AuthNotifier(this.ref) : super(AuthState(status: AuthStatus.initial)) {
    ref.listen(sessionRejectionProvider, (previous, next) {
      _sessionGeneration++;
      ref.read(socketServiceProvider).disconnect();
      ref.read(userProvider.notifier).logout();
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Your session has expired. Please sign in again.',
      );
    });
    checkAuthStatus();
  }

  Future<void> checkAuthStatus() async {
    if (_isProcessing) return;
    _isProcessing = true;
    final generation = _sessionGeneration;
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
        'AuthNotifier: token: ${token != null ? "found" : "null"}, identity stored: ${userId != null}',
      );
      if (generation != _sessionGeneration) return;

      if (token != null && userId != null) {
        state = state.copyWith(status: AuthStatus.restoring);
        try {
          debugPrint('AuthNotifier: Restoring authenticated profile');
          final publicUser = await ref
              .read(getUserProfileUseCaseProvider)
              .execute(userId)
              .timeout(const Duration(seconds: 7));
          final currentToken = await ref
              .read(secureStorageProvider)
              .read(key: 'auth_token');
          final role = authRoleFromToken(currentToken ?? token);
          if (generation != _sessionGeneration || currentToken == null) return;
          if (role != 'customer') {
            await _clearSession(
              'Use the appropriate app for this account role.',
            );
            return;
          }
          await ref
              .read(secureStorageProvider)
              .write(key: 'user_role', value: role);
          if (generation != _sessionGeneration) return;
          debugPrint(
            'AuthNotifier: Profile fetched, role: $role. Authenticating...',
          );
          ref.read(userProvider.notifier).setUser(publicUser.toEntity(role));
          ref.read(socketServiceProvider).connect(currentToken);
          unawaited(
            ref.read(notificationServiceProvider).syncAuthenticatedDevice(),
          );
          state = state.copyWith(status: AuthStatus.authenticated);
          debugPrint('AuthNotifier: Authenticated successfully');
        } catch (e) {
          if (generation != _sessionGeneration) return;
          if (!_isTransientProfileFailure(e)) {
            await _clearSession(
              'Your session could not be verified. Please sign in again.',
            );
            return;
          }
          debugPrint(
            'AuthNotifier: Profile fetch failed: ${e.runtimeType}. Reverting to unauthenticated.',
          );
          ref.read(userProvider.notifier).logout();
          state = AuthState(
            status: AuthStatus.unauthenticated,
            errorMessage: 'Could not restore your session. Check your connection and retry.',
          );
        }
      } else {
        debugPrint('AuthNotifier: No session found. Unauthenticated.');
        state = state.copyWith(status: AuthStatus.unauthenticated);
      }
    } catch (e) {
      debugPrint('AuthNotifier: Session restoration failed: ${e.runtimeType}');
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Could not restore your session. Please sign in again.',
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
      signupId: null,
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
    final generation = _sessionGeneration;
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
        await _handleAuthSuccess(response, generation);
      } catch (e) {
        final message = _parseError(e);
        state = state.copyWith(
          status: state.signupId != null
              ? AuthStatus.otpRequired
              : AuthStatus.unauthenticated,
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
        await _handleAuthSuccess(response, generation);
      } catch (e) {
        final message = _parseError(e);
        state = state.copyWith(
          status: state.loginChallengeId != null
              ? AuthStatus.otpRequired
              : AuthStatus.unauthenticated,
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
      loginChallengeId: null,
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
    final generation = _sessionGeneration;
    state = AuthState(status: AuthStatus.loading);
    var stage = 'API request';
    try {
      final response = await ref
          .read(dioProvider)
          .post(
            '/auth/google',
            data: {'idToken': idToken, 'accountRole': 'customer'},
            options: Options(extra: {'withCredentials': true}),
          );
      debugPrint('Google auth: API HTTP ${response.statusCode}');
      stage = 'session/profile';
      await _handleAuthSuccess(
        AuthResponse.fromJson(response.data['data']),
        generation,
      );
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

  Future<bool> resendOtp() async {
    if (_isProcessing ||
        (state.signupId == null && state.loginChallengeId == null)) {
      return false;
    }
    _isProcessing = true;
    state = state.copyWith(status: AuthStatus.loading, errorMessage: null);
    try {
      if (state.signupId != null) {
        final request = ResendSignupRequest(signupId: state.signupId!);
        await ref.read(resendSignupOtpUseCaseProvider).execute(request);
      } else if (state.loginChallengeId != null) {
        final request = ResendLoginRequest(
          challengeId: state.loginChallengeId!,
        );
        await ref
            .read(resendLoginOtpUseCaseProvider)
            .execute(request, state.loginChannel);
      }
      state = state.copyWith(status: AuthStatus.otpRequired);
      return true;
    } catch (e) {
      state = state.copyWith(
        status: AuthStatus.otpRequired,
        errorMessage: _parseError(e),
      );
      return false;
    } finally {
      _isProcessing = false;
    }
  }

  Future<void> _handleAuthSuccess(AuthResponse response, int generation) async {
    if (generation != _sessionGeneration) {
      throw StateError('Authentication was cancelled. Please sign in again.');
    }
    final role = authRoleFromToken(response.accessToken);
    if (role != 'customer') {
      throw StateError(
        'Choose a Customer account to sign in to the Customer app.',
      );
    }
    await ref
        .read(secureStorageProvider)
        .write(key: 'auth_token', value: response.accessToken);
    await ref
        .read(secureStorageProvider)
        .write(key: 'user_id', value: response.userId);

    late PublicUser publicUser;
    try {
      publicUser = await ref
          .read(getUserProfileUseCaseProvider)
          .execute(response.userId);
      if (generation != _sessionGeneration ||
          await ref.read(secureStorageProvider).read(key: 'auth_token') ==
              null) {
        throw StateError('Session ended before authentication completed.');
      }
    } catch (error) {
      if (generation != _sessionGeneration) rethrow;
      if (_isTransientProfileFailure(error)) {
        // The server has already verified Google/OTP. Keep its credentials for
        // a profile retry, while the router continues to deny protected screens.
        state = AuthState(
          status: AuthStatus.unauthenticated,
          errorMessage: 'Sign-in was verified. Check your connection and retry your saved session.',
        );
      } else {
        await _clearSession(null);
      }
      rethrow;
    }

    await ref.read(secureStorageProvider).write(key: 'user_role', value: role);
    if (generation != _sessionGeneration) return;

    ref.read(userProvider.notifier).setUser(publicUser.toEntity(role));
    ref.read(socketServiceProvider).connect(response.accessToken);

    unawaited(ref.read(notificationServiceProvider).syncAuthenticatedDevice());

    state = AuthState(status: AuthStatus.authenticated);
  }

  void cancelOtp() {
    if (_isProcessing) return;
    state = AuthState(status: AuthStatus.unauthenticated);
  }

  bool _isTransientProfileFailure(Object error) {
    if (error is TimeoutException) return true;
    if (error is! DioException) return false;
    final status = error.response?.statusCode;
    return status == 408 ||
        status == 429 ||
        (status != null && status >= 500) ||
        error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout;
  }

  Future<void> logout() async {
    _sessionGeneration++;
    _isProcessing = true;
    state = AuthState(status: AuthStatus.loading);
    String? logoutError;
    try {
      await ref.read(notificationServiceProvider).unregisterDevice();
    } catch (_) {
      // Device cleanup must not prevent server-side session revocation.
    }
    try {
      await ref.read(logoutUseCaseProvider).execute();
    } catch (_) {
      logoutError =
          'Signed out locally; the server session could not be revoked.';
    } finally {
      try {
        await _clearSession(logoutError);
      } finally {
        _isProcessing = false;
      }
    }
  }

  Future<bool> deleteAccount() async {
    try {
      final response = await ref.read(dioProvider).delete('/auth/account');
      if (response.statusCode != 204 && response.data['success'] != true) {
        throw StateError('Account deletion was not confirmed by the backend.');
      }
      await _clearSession(null);
      return true;
    } catch (error) {
      state = state.copyWith(errorMessage: _parseError(error));
      return false;
    }
  }

  Future<void> _clearSession(String? logoutError) async {
    _sessionGeneration++;
    ref.read(socketServiceProvider).disconnect();
    ref.read(userProvider.notifier).logout();
    state = AuthState(
      status: AuthStatus.unauthenticated,
      errorMessage: logoutError,
    );
    await ref.read(secureStorageProvider).delete(key: 'auth_token');
    await ref.read(secureStorageProvider).delete(key: 'user_id');
    await ref.read(secureStorageProvider).delete(key: 'user_role');
    await ref.read(secureStorageProvider).delete(key: 'auth_csrf_token');
    if (!kIsWeb) {
      try {
        await (await ref.read(cookieJarProvider.future)).deleteAll();
      } catch (_) {
        // Missing platform storage must not keep the local UI authenticated.
      }
    }
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
