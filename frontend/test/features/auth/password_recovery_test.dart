import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:infurnus/features/auth/presentation/screens/signup_screen.dart';
import 'package:infurnus/features/auth/data/datasources/auth_remote_data_source.dart';
import 'package:infurnus/features/auth/data/models/auth_models.dart';
import 'package:infurnus/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:infurnus/features/auth/presentation/providers/auth_repository_provider.dart';
import 'package:infurnus/features/auth/presentation/screens/password_recovery_screen.dart';

class AuthAdapter implements HttpClientAdapter {
  final calls = <RequestOptions>[];
  String? failurePath;
  int failureStatus = 400;
  bool expired = false;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    if (options.path == '/auth/signup' ||
        options.path == '/auth/signup/resend') {
      return ResponseBody.fromString(
        jsonEncode({
          'success': true,
          'data': {
            'signupId': 'signup-test',
            'contactType': 'email',
            'expiresAt': DateTime.now()
                .add(const Duration(minutes: 10))
                .toIso8601String(),
          },
        }),
        201,
        headers: {
          'content-type': ['application/json'],
        },
      );
    }
    if (options.path == '/auth/login/resend') {
      return ResponseBody.fromString(
        jsonEncode({
          'success': true,
          'data': {
            'challengeId': 'login-test',
            'expiresAt': DateTime.now()
                .add(const Duration(minutes: 10))
                .toIso8601String(),
          },
        }),
        200,
        headers: {
          'content-type': ['application/json'],
        },
      );
    }
    if (options.path == failurePath) {
      return ResponseBody.fromString(
        jsonEncode({
          'success': false,
          'error': {'message': 'Backend rejected request'},
        }),
        failureStatus,
        headers: {
          'content-type': ['application/json'],
        },
      );
    }
    final data = options.path == '/auth/reset-password'
        ? {'message': 'Password reset successfully'}
        : {
            'resetSessionToken': 'a' * 64,
            'expiresAt': DateTime.now()
                .add(Duration(minutes: expired ? -1 : 10))
                .toUtc()
                .toIso8601String(),
            if (options.path.endsWith('/verify')) 'verified': true,
          };
    return ResponseBody.fromString(
      jsonEncode({'success': true, 'data': data}),
      200,
      headers: {
        'content-type': ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late AuthAdapter adapter;
  late AuthRemoteDataSourceImpl source;
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    adapter = AuthAdapter();
    final dio = Dio(BaseOptions(baseUrl: 'http://auth.test'))
      ..httpClientAdapter = adapter;
    source = AuthRemoteDataSourceImpl(dio);
  });
  Future<void> mount(WidgetTester tester) async {
    final router = GoRouter(
      initialLocation: '/forgot-password',
      routes: [
        GoRoute(
          path: '/forgot-password',
          builder: (_, __) => const PasswordRecoveryScreen(),
        ),
        GoRoute(
          path: '/login',
          builder: (_, __) => const Scaffold(body: Text('Login destination')),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(AuthRepositoryImpl(source)),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
  }

  Future<void> send(WidgetTester tester) async {
    await tester.enterText(
      find.byKey(const Key('recovery-email')),
      'person@example.com',
    );
    await tester.tap(find.text('Send code'));
    await tester.pumpAndSettle();
  }

  testWidgets('email validation prevents requests', (tester) async {
    await mount(tester);
    await tester.tap(find.text('Send code'));
    await tester.pump();
    expect(find.text('Email is required'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('recovery-email')), 'bad');
    await tester.tap(find.text('Send code'));
    await tester.pump();
    expect(find.text('Enter a valid email address'), findsOneWidget);
    expect(adapter.calls, isEmpty);
  });
  testWidgets('complete recovery uses backend contracts and returns to login', (
    tester,
  ) async {
    await mount(tester);
    await send(tester);
    expect(adapter.calls.single.data, {'email': 'person@example.com'});
    expect(find.byKey(const Key('recovery-password')), findsNothing);
    await tester.enterText(find.byKey(const Key('recovery-otp')), '123456');
    await tester.tap(find.text('Verify code'));
    await tester.pumpAndSettle();
    expect(adapter.calls.last.data, {
      'resetSessionToken': 'a' * 64,
      'otp': '123456',
    });
    await tester.enterText(
      find.byKey(const Key('recovery-password')),
      'NewPassword123!',
    );
    await tester.enterText(
      find.byKey(const Key('recovery-confirmation')),
      'different',
    );
    await tester.tap(find.text('Reset password'));
    await tester.pump();
    expect(find.text('Passwords do not match'), findsOneWidget);
    expect(adapter.calls, hasLength(2));
    await tester.enterText(
      find.byKey(const Key('recovery-confirmation')),
      'NewPassword123!',
    );
    await tester.tap(find.text('Reset password'));
    await tester.pumpAndSettle();
    expect(adapter.calls.last.path, '/auth/reset-password');
    expect(adapter.calls.last.data, {
      'resetSessionToken': 'a' * 64,
      'password': 'NewPassword123!',
      'confirmPassword': 'NewPassword123!',
    });
    expect(find.text('Login destination'), findsOneWidget);
  });
  testWidgets('provider error never advances to OTP', (tester) async {
    adapter.failurePath = '/auth/forgot-password';
    adapter.failureStatus = 502;
    await mount(tester);
    await send(tester);
    expect(find.text('Backend rejected request'), findsOneWidget);
    expect(find.byKey(const Key('recovery-otp')), findsNothing);
  });
  testWidgets('invalid OTP remains on OTP and can retry', (tester) async {
    adapter.failurePath = '/auth/forgot-password/verify';
    await mount(tester);
    await send(tester);
    await tester.enterText(find.byKey(const Key('recovery-otp')), '000000');
    await tester.tap(find.text('Verify code'));
    await tester.pumpAndSettle();
    expect(find.text('Backend rejected request'), findsOneWidget);
    expect(find.byKey(const Key('recovery-password')), findsNothing);
    adapter.failurePath = null;
    await tester.enterText(find.byKey(const Key('recovery-otp')), '123456');
    await tester.tap(find.text('Verify code'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('recovery-password')), findsOneWidget);
  });
  testWidgets('expired recovery disables verification', (tester) async {
    adapter.expired = true;
    await mount(tester);
    await send(tester);
    expect(
      find.text('Recovery session expired. Request a new code.'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Verify code'),
          )
          .onPressed,
      isNull,
    );
  });
  test(
    'request new code uses forgot-password, no invented resend endpoint',
    () async {
      await source.forgotPassword('person@example.com');
      await source.forgotPassword('person@example.com');
      expect(
        adapter.calls.map((c) => c.path),
        everyElement('/auth/forgot-password'),
      );
    },
  );
  test('signup and login resend preserve backend contracts', () async {
    expect(
      (await source.resendSignupOtp(
        ResendSignupRequest(signupId: 'signup-test'),
      )).contactType,
      'email',
    );
    expect(adapter.calls.last.data, {'signupId': 'signup-test'});
    expect(
      (await source.resendLoginEmailOtp(
        ResendLoginRequest(challengeId: 'login-test'),
      )).challengeId,
      'login-test',
    );
    expect(adapter.calls.last.data, {'challengeId': 'login-test'});
    expect(adapter.calls.last.path, '/auth/login/resend');
  });
  test('refresh obtains user ID from access-token subject', () {
    final payload = base64Url
        .encode(utf8.encode(jsonEncode({'sub': 'user-id', 'role': 'driver'})))
        .replaceAll('=', '');
    final response = AuthResponse.fromJson({
      'accessToken': 'header.$payload.signature',
      'expiresAt': '2099-01-01',
    });
    expect(response.userId, 'user-id');
  });
  test('customer-only navigation preserves server token roles', () {
    for (final role in [
      'customer',
      'driver',
      'fleet_owner',
      'driver_fleet_owner',
      'admin',
      'super_admin',
    ]) {
      final payload = base64Url
          .encode(utf8.encode(jsonEncode({'role': role})))
          .replaceAll('=', '');
      expect(authRoleFromToken('header.$payload.signature'), role);
    }
    expect(authHomeRoute('fleet_owner'), '/customer-home');
    expect(authHomeRoute('driver'), '/customer-home');
    expect(authHomeRoute('admin'), '/customer-home');
  });
  testWidgets(
    'customer-only signup validates password and submits customer role',
    (tester) async {
      final router = GoRouter(
        initialLocation: '/signup',
        routes: [
          GoRoute(path: '/signup', builder: (_, __) => const SignupScreen()),
          GoRoute(
            path: '/otp',
            builder: (_, __) =>
                const Scaffold(body: Text('Signup OTP destination')),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authRepositoryProvider.overrideWithValue(
              AuthRepositoryImpl(source),
            ),
          ],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      for (final entry in {
        'First Name': 'Driver',
        'Last Name': 'Test',
        'name@example.com': 'driver@example.com',
        'Password': 'short',
        'Confirm Password': 'short',
      }.entries) {
        await tester.enterText(
          find.byWidgetPredicate(
            (w) => w is TextField && w.decoration?.hintText == entry.key,
          ),
          entry.value,
        );
      }
      expect(
        find.widgetWithText(RadioListTile<String>, 'Driver'),
        findsNothing,
      );
      expect(find.text('Driving licence number'), findsNothing);
      await tester.ensureVisible(find.text('Sign Up   →'));
      await tester.tap(find.text('Sign Up   →'));
      await tester.pumpAndSettle();
      expect(find.text('Password must be 8–128 characters.'), findsOneWidget);
      expect(adapter.calls, isEmpty);
      for (final hint in ['Password', 'Confirm Password']) {
        await tester.enterText(
          find.byWidgetPredicate(
            (w) => w is TextField && w.decoration?.hintText == hint,
          ),
          'Password123!',
        );
      }

      await tester.ensureVisible(find.text('Sign Up   →'));
      await tester.tap(find.text('Sign Up   →'));
      await tester.pumpAndSettle();
      expect(adapter.calls.single.data, containsPair('role', 'customer'));
      expect(
        (adapter.calls.single.data as Map).containsKey('licenseNumber'),
        isFalse,
      );
      expect(
        (adapter.calls.single.data as Map).containsKey('licenseExpiry'),
        isFalse,
      );
      expect(find.text('Signup OTP destination'), findsOneWidget);
    },
  );
  test('driver signup serializes required licence fields', () {
    final request = SignupRequest(
      firstName: 'Driver',
      lastName: 'Test',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      role: 'driver',
      licenseNumber: 'DL-123',
      licenseExpiry: '2099-01-01',
    );
    expect(request.toJson(), containsPair('licenseNumber', 'DL-123'));
    expect(request.toJson(), containsPair('licenseExpiry', '2099-01-01'));
  });
}
