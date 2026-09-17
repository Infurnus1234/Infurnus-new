import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/usecases/signup_use_case.dart';
import '../../domain/usecases/verify_signup_otp_use_case.dart';
import '../../domain/usecases/resend_signup_otp_use_case.dart';
import '../../domain/usecases/login_use_case.dart';
import '../../domain/usecases/verify_login_otp_use_case.dart';
import '../../domain/usecases/resend_login_otp_use_case.dart';
import '../../domain/usecases/refresh_token_use_case.dart';
import '../../domain/usecases/logout_use_case.dart';
import '../../domain/usecases/get_user_profile_use_case.dart';
import 'auth_repository_provider.dart';

final signupUseCaseProvider = Provider<SignupUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return SignupUseCase(repository);
});

final verifySignupOtpUseCaseProvider = Provider<VerifySignupOtpUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return VerifySignupOtpUseCase(repository);
});

final resendSignupOtpUseCaseProvider = Provider<ResendSignupOtpUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return ResendSignupOtpUseCase(repository);
});

final loginUseCaseProvider = Provider<LoginUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return LoginUseCase(repository);
});

final verifyLoginOtpUseCaseProvider = Provider<VerifyLoginOtpUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return VerifyLoginOtpUseCase(repository);
});

final resendLoginOtpUseCaseProvider = Provider<ResendLoginOtpUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return ResendLoginOtpUseCase(repository);
});

final refreshTokenUseCaseProvider = Provider<RefreshTokenUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return RefreshTokenUseCase(repository);
});

final logoutUseCaseProvider = Provider<LogoutUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return LogoutUseCase(repository);
});

final getUserProfileUseCaseProvider = Provider<GetUserProfileUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return GetUserProfileUseCase(repository);
});
