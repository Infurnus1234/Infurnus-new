import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/auth/data/datasources/auth_remote_data_source.dart';
import 'package:infurnus/features/auth/data/models/auth_models.dart';

void main() {
  const url = String.fromEnvironment('AUTH_BACKEND_TEST_URL');
  const email = String.fromEnvironment('AUTH_TEST_EMAIL');
  test(
    'actual backend signup, resend, login, recovery, refresh and logout',
    () async {
      final cookies = CookieJar();
      String? token;
      final dio = Dio(BaseOptions(baseUrl: url));
      dio.interceptors.add(CookieManager(cookies));
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) async {
            if (token != null) {
              options.headers['Authorization'] = 'Bearer $token';
            }
            for (final cookie in await cookies.loadForRequest(
              Uri.parse('$url/auth'),
            )) {
              if (cookie.name == 'infurnus_csrf_token') {
                options.headers['X-CSRF-Token'] = cookie.value;
              }
            }
            handler.next(options);
          },
        ),
      );
      final source = AuthRemoteDataSourceImpl(dio);
      const original = 'OriginalPassword123!';
      try {
        final signup = await source.signup(
          SignupRequest(
            firstName: 'Frontend',
            lastName: 'Audit',
            email: email,
            password: original,
            confirmPassword: original,
            role: 'customer',
          ),
        );
        await expectLater(
          source.verifySignup(
            VerifySignupRequest(signupId: signup.signupId, otp: '000000'),
          ),
          throwsA(isA<DioException>()),
        );
        final auth = await source.verifySignup(
          VerifySignupRequest(signupId: signup.signupId, otp: '123456'),
        );
        token = auth.accessToken;
        expect(authRoleFromToken(token), 'customer');
        await source.getUserProfile(auth.userId);
        await expectLater(
          source.login(LoginRequest(email: email, password: 'wrong-password')),
          throwsA(isA<DioException>()),
        );
        final login = await source.loginEmail(
          LoginRequest(email: email, password: original),
        );
        await expectLater(
          source.verifyLoginEmail(
            VerifyLoginRequest(challengeId: login.challengeId, otp: '000000'),
          ),
          throwsA(isA<DioException>()),
        );
        token = (await source.verifyLoginEmail(
          VerifyLoginRequest(challengeId: login.challengeId, otp: '123456'),
        )).accessToken;
        token = (await source.refreshToken()).accessToken;
        final recovery = await source.forgotPassword(email);
        await expectLater(
          source.verifyPasswordResetOtp(recovery.token, '000000'),
          throwsA(isA<DioException>()),
        );
        final verified = await source.verifyPasswordResetOtp(
          recovery.token,
          '123456',
        );
        const password = 'NewFrontendPassword123!';
        await source.resetPassword(verified.token, password, password);
        await expectLater(
          source.loginEmail(LoginRequest(email: email, password: original)),
          throwsA(isA<DioException>()),
        );
        final updated = await source.loginEmail(
          LoginRequest(email: email, password: password),
        );
        token = (await source.verifyLoginEmail(
          VerifyLoginRequest(challengeId: updated.challengeId, otp: '123456'),
        )).accessToken;
        await source.logout();
        await expectLater(source.refreshToken(), throwsA(isA<DioException>()));
      } finally {
        await dio.post('/__auth_test_shutdown');
        dio.close();
      }
    },
    skip: url.isEmpty
        ? 'Run with disposable auth backend and AUTH_BACKEND_TEST_URL'
        : false,
  );
}
