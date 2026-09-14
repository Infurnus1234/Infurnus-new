import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../data/models/auth_models.dart';
import 'auth_use_case_providers.dart';
import 'user_provider.dart';

enum AuthStatus { initial, authenticated, unauthenticated, loading, otpRequired }

class AuthState {
  final AuthStatus status;
  final String? errorMessage;
  final String? signupId;

  AuthState({required this.status, this.errorMessage, this.signupId});

  AuthState copyWith({AuthStatus? status, String? errorMessage, String? signupId}) {
    return AuthState(
      status: status ?? this.status,
      errorMessage: errorMessage ?? this.errorMessage,
      signupId: signupId ?? this.signupId,
    );
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  final Ref ref;

  AuthNotifier(this.ref) : super(AuthState(status: AuthStatus.initial)) {
    checkAuthStatus();
  }

  Future<void> checkAuthStatus() async {
    final token = await ref.read(secureStorageProvider).read(key: 'auth_token');
    final userId = await ref.read(secureStorageProvider).read(key: 'user_id');
    
    if (token != null && userId != null) {
      try {
        final publicUser = await ref.read(getUserProfileUseCaseProvider).execute(userId);
        // We might need to store the role in secure storage too or derive it
        final role = await ref.read(secureStorageProvider).read(key: 'user_role') ?? 'customer';
        ref.read(userProvider.notifier).setUser(publicUser.toEntity(role));
        state = state.copyWith(status: AuthStatus.authenticated);
      } catch (e) {
        state = state.copyWith(status: AuthStatus.unauthenticated);
      }
    } else {
      state = state.copyWith(status: AuthStatus.unauthenticated);
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
      state = state.copyWith(status: AuthStatus.unauthenticated, errorMessage: e.toString());
    }
  }

  Future<void> verifyOtp(String otp) async {
    if (state.signupId == null) return;
    
    state = state.copyWith(status: AuthStatus.loading);
    try {
      final request = VerifySignupRequest(signupId: state.signupId!, otp: otp);
      final response = await ref.read(verifySignupOtpUseCaseProvider).execute(request);
      
      await _handleAuthSuccess(response);
    } catch (e) {
      state = state.copyWith(status: AuthStatus.otpRequired, errorMessage: e.toString());
    }
  }

  Future<void> login(LoginRequest request) async {
    state = state.copyWith(status: AuthStatus.loading);
    try {
      final response = await ref.read(loginUseCaseProvider).execute(request);
      await _handleAuthSuccess(response);
    } catch (e) {
      state = state.copyWith(status: AuthStatus.unauthenticated, errorMessage: e.toString());
    }
  }

  Future<void> _handleAuthSuccess(AuthResponse response) async {
    await ref.read(secureStorageProvider).write(key: 'auth_token', value: response.accessToken);
    await ref.read(secureStorageProvider).write(key: 'user_id', value: response.userId);
    
    final publicUser = await ref.read(getUserProfileUseCaseProvider).execute(response.userId);
    
    // Role handling - in a real app, role comes from the profile or token.
    // Defaulting to 'customer' if not available in the current DTO.
    const role = 'customer';
    await ref.read(secureStorageProvider).write(key: 'user_role', value: role);

    ref.read(userProvider.notifier).setUser(publicUser.toEntity(role));
    state = state.copyWith(status: AuthStatus.authenticated);
  }

  Future<void> logout() async {
    try {
      await ref.read(logoutUseCaseProvider).execute();
    } catch (_) {} finally {
      await ref.read(secureStorageProvider).delete(key: 'auth_token');
      await ref.read(secureStorageProvider).delete(key: 'user_id');
      await ref.read(secureStorageProvider).delete(key: 'user_role');
      ref.read(userProvider.notifier).logout();
      state = state.copyWith(status: AuthStatus.unauthenticated, signupId: null);
    }
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
