import 'package:flutter/foundation.dart';
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
    'actual Customer backend signup, OTP login, recovery policy, refresh and logout',
    () async {
      final cookies = CookieJar();
      String? token;
      final dio = Dio(BaseOptions(baseUrl: url));
      dio.interceptors.add(CookieManager(cookies));
      dio.interceptors.add(
        InterceptorsWrapper(
          onError: (error, handler) {
            // Endpoint and public error code only; never log a session token.
            debugPrint(
              'Contract response: ${error.requestOptions.path} ${error.response?.statusCode} ${(error.response?.data as Map?)?['error']?['code']}',
            );
            handler.next(error);
          },
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
        // Customer login is OTP-based in the existing backend. A password
        // string can request a challenge, but cannot grant an access token.
        final anonymousDio = Dio(BaseOptions(baseUrl: url));
        Map? challengeData;
        anonymousDio.interceptors.add(
          InterceptorsWrapper(
            onResponse: (response, handler) {
              if (response.requestOptions.path == '/auth/login') {
                challengeData = Map.from(response.data['data'] as Map);
              }
              handler.next(response);
            },
          ),
        );
        final anonymous = AuthRemoteDataSourceImpl(anonymousDio);
        final challenge = await anonymous.login(
          LoginRequest(email: email, password: 'wrong-password'),
        );
        expect(challenge.challengeId, isNotEmpty);
        expect(challengeData, isNot(contains('accessToken')));
        await expectLater(
          anonymous.verifyLogin(
            VerifyLoginRequest(
              challengeId: challenge.challengeId,
              otp: '000000',
            ),
          ),
          throwsA(isA<DioException>()),
        );
        await expectLater(
          anonymous.getUserProfile(auth.userId),
          throwsA(
            isA<DioException>().having(
              (e) => e.response?.statusCode,
              'unauthenticated status',
              401,
            ),
          ),
        );
        final anonymousVerified = await anonymous.verifyLogin(
          VerifyLoginRequest(challengeId: challenge.challengeId, otp: '123456'),
        );
        expect(anonymousVerified.userId, auth.userId);
        expect(authRoleFromToken(anonymousVerified.accessToken), 'customer');
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
        // The existing role-scoped backend intentionally disallows password
        // recovery for OTP-only Customer/Driver roles. Its opaque response
        // must not turn a correct-looking code into a usable reset session.
        await expectLater(
          source.verifyPasswordResetOtp(recovery.token, '123456'),
          throwsA(
            isA<DioException>().having(
              (e) => (e.response?.data as Map?)?['error']?['code'],
              'recovery policy',
              'INVALID_PASSWORD_RESET_SESSION',
            ),
          ),
        );
        await expectLater(
          source.resetPassword(
            recovery.token,
            'NewFrontendPassword123!',
            'NewFrontendPassword123!',
          ),
          throwsA(isA<DioException>()),
        );
        anonymousDio.close();
        final updated = await source.loginEmail(LoginRequest(email: email));
        token = (await source.verifyLoginEmail(
          VerifyLoginRequest(challengeId: updated.challengeId, otp: '123456'),
        )).accessToken;
        expect(authRoleFromToken(token), 'customer');
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
