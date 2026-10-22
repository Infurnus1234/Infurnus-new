import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/features/auth/presentation/screens/login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:infurnus/features/auth/presentation/widgets/google_sign_in_button.dart';

class _GooglePlatform extends GoogleSignInPlatform {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  int calls = 0;
  Object? failure;
  @override
  Future<void> init(InitParameters params) async {}
  @override
  Future<AuthenticationResults> authenticate(
    AuthenticateParameters params,
  ) async {
    calls++;
    if (failure != null) throw failure!;
    return const AuthenticationResults(
      user: GoogleSignInUserData(
        email: 'fixture@example.com',
        id: 'fixture-subject',
      ),
      authenticationTokens: AuthenticationTokenData(
        idToken: 'sdk.fixture.token',
      ),
    );
  }
}

void main() {
  final platform = _GooglePlatform();
  GoogleSignInPlatform.instance = platform;
  testWidgets(
    'SDK cancellation sends no token and merged login forwards the actual SDK Customer token',
    (tester) async {
      final received = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: GoogleSignInButton(
              enabled: true,
              onIdToken: (token) async {
                received.add(token);
              },
              child: const Text('Google test'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Google test'));
      await tester.pumpAndSettle();
      expect(platform.calls, 1);
      expect(received, ['sdk.fixture.token']);
      platform.failure = const GoogleSignInException(
        code: GoogleSignInExceptionCode.canceled,
      );
      await tester.tap(find.text('Google test'));
      await tester.pumpAndSettle();
      expect(platform.calls, 2);
      expect(received, ['sdk.fixture.token']);
      expect(
        find.text('Google sign-in was canceled. Please try again.'),
        findsOneWidget,
      );

      // Keep SDK initialization and its cached Future in one fake-async zone.

      FlutterSecureStorage.setMockInitialValues({});
      platform.failure = null;
      final calls = <RequestOptions>[];
      final dio = Dio(BaseOptions(baseUrl: 'https://fixture.invalid'));
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            calls.add(options);
            handler.reject(
              DioException(
                requestOptions: options,
                response: Response(
                  requestOptions: options,
                  statusCode: 401,
                  data: {
                    'error': {'message': 'Fixture account rejected'},
                  },
                ),
              ),
            );
          },
        ),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [dioProvider.overrideWithValue(dio)],
          child: const MaterialApp(home: LoginScreen()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Sign in with Google'));
      await tester.pumpAndSettle();
      final previousCalls = platform.calls;
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Sign in with Google'),
            )
            .onPressed,
        isNotNull,
      );
      await tester.tap(find.text('Sign in with Google'));
      await tester.pumpAndSettle();
      expect(platform.calls, previousCalls + 1);
      expect(calls, hasLength(1));
      expect(calls.single.path, '/auth/google');
      expect(calls.single.data, {
        'idToken': 'sdk.fixture.token',
        'accountRole': 'customer',
      });
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      dio.close();
    },
  );
}
