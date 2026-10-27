import 'dart:async';
import 'dart:convert';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:infurnus/app/router/router.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/network/session_events.dart';
import 'package:infurnus/core/services/notification_service.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/core/storage/secure_storage.dart';
import 'package:infurnus/features/auth/data/models/auth_models.dart';
import 'package:infurnus/features/auth/presentation/providers/auth_provider.dart';
import 'package:infurnus/features/auth/presentation/providers/user_provider.dart';

class QuietSocket extends SocketService {
  int disconnects = 0;
  @override
  void connect(String token) {}
  @override
  void disconnect() {
    disconnects++;
  }
}

class QuietNotifications extends NotificationService {
  QuietNotifications() : super(Dio());
  @override
  Future<void> syncAuthenticatedDevice() async {}
  @override
  Future<void> unregisterDevice() async {}
}

class _QuietGoogle extends GoogleSignInPlatform {
  @override
  Future<void> init(InitParameters params) async {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

String customerToken([String role = 'customer']) =>
    'fixture.${base64Url.encode(utf8.encode(jsonEncode({'sub': 'fixture-user', 'role': role})))}.signature';

Future<void> restored(ProviderContainer container) async {
  for (var i = 0; i < 100; i++) {
    final status = container.read(authProvider).status;
    if (status != AuthStatus.initial && status != AuthStatus.restoring) return;
    await Future<void>.delayed(const Duration(milliseconds: 1));
  }
  fail('Session restoration did not finish');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  GoogleSignInPlatform.instance = _QuietGoogle();

  test(
    'every incomplete auth state rejects protected routes and deep links',
    () {
      for (final status in AuthStatus.values) {
        for (final path in [
          '/customer-home',
          '/profile',
          '/wallet',
          '/ride-booking',
          '/booking-history',
          '/ai-assistant/admin',
        ]) {
          final target = authRedirect(AuthState(status: status), path, null);
          expect(
            target,
            isNotNull,
            reason: '$status $path cannot grant access',
          );
          expect(target, isNot('/customer-home'));
        }
      }
      for (final path in [
        '/login',
        '/signup',
        '/forgot-password',
        '/legal/privacy',
      ]) {
        expect(
          authRedirect(
            AuthState(status: AuthStatus.unauthenticated),
            path,
            null,
          ),
          isNull,
        );
      }
      expect(
        authRedirect(
          AuthState(status: AuthStatus.authenticated),
          '/customer-home',
          'customer',
        ),
        isNull,
      );
      for (final role in [
        'driver',
        'fleet_owner',
        'driver_fleet_owner',
        'admin',
        'super_admin',
      ]) {
        expect(
          authRedirect(
            AuthState(status: AuthStatus.authenticated),
            '/customer-home',
            role,
          ),
          '/login',
        );
      }
    },
  );

  testWidgets(
    'clean startup and direct links show login; signup stays visible and opens',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      Map<String, dynamic>? signupBody;
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            expect(options.path, '/auth/signup');
            signupBody = Map<String, dynamic>.from(options.data as Map);
            handler.resolve(
              Response(
                requestOptions: options,
                statusCode: 201,
                data: {
                  'data': {
                    'signupId': 'email-signup',
                    'contactType': 'email',
                    'expiresAt': '2099-01-01T00:00:00Z',
                  },
                },
              ),
            );
          },
        ),
      );
      final container = ProviderContainer(
        overrides: [dioProvider.overrideWithValue(dio)],
      );
      addTearDown(container.dispose);
      final router = container.read(routerProvider);
      addTearDown(router.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/login');
      expect(find.text('Welcome Back'), findsOneWidget);
      expect(find.textContaining('Skip'), findsNothing);
      expect(container.read(userProvider), isNull);
      for (final path in [
        '/customer-home',
        '/wallet',
        '/profile',
        '/ride-booking',
      ]) {
        router.go(path);
        await tester.pumpAndSettle();
        expect(router.routeInformationProvider.value.uri.path, '/login');
      }
      final signup = find.textContaining('Sign Up', findRichText: true);
      await tester.ensureVisible(signup);
      await tester.tap(signup);
      await tester.pumpAndSettle();
      expect(
        find.text('Create a Customer Account', findRichText: true),
        findsOneWidget,
      );
      expect(find.text('Sign Up'), findsOneWidget);
      await tester.tap(find.text('Use Email').last);
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(TextField, 'Enter Email Address'),
        findsOneWidget,
      );
      expect(
        find.widgetWithText(TextField, 'Phone Number (+91)'),
        findsNothing,
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'First Name'),
        'Email',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Last Name'),
        'Customer',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Enter Email Address'),
        'signup@example.com',
      );
      final submit = find.text('Sign Up');
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(signupBody, {
        'firstName': 'Email',
        'lastName': 'Customer',
        'email': 'signup@example.com',
        'role': 'customer',
      });
      expect(router.routeInformationProvider.value.uri.path, '/otp');
      expect(find.text('Verify your email'), findsOneWidget);
      expect(container.read(userProvider), isNull);
      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();
      expect(router.routeInformationProvider.value.uri.path, '/login');
      router.go('/signup');
      await tester.pumpAndSettle();
      expect(
        find.text('Create a Customer Account', findRichText: true),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final channel in ['email', 'phone']) {
    test(
      '$channel signup and existing login require verification, reject bad OTP, restore and logout',
      () async {
        FlutterSecureStorage.setMockInitialValues({});
        final dio = Dio();
        final calls = <RequestOptions>[];
        var invalid = false;
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              calls.add(options);
              Object data;
              if (options.path.endsWith('/verify') && invalid) {
                handler.reject(
                  DioException(
                    requestOptions: options,
                    response: Response(
                      requestOptions: options,
                      statusCode: 400,
                      data: {
                        'error': {'message': 'Invalid or expired OTP'},
                      },
                    ),
                  ),
                );
                return;
              }
              switch (options.path) {
                case '/auth/signup':
                  data = {
                    'signupId': 'signup',
                    'contactType': channel,
                    'expiresAt': '2099-01-01T00:00:00Z',
                  };
                case '/auth/login':
                  data = {
                    'challengeId': 'login',
                    'expiresAt': '2099-01-01T00:00:00Z',
                  };
                case '/auth/signup/verify':
                case '/auth/login/verify':
                  data = {
                    'userId': 'fixture-user',
                    'accessToken': customerToken(),
                    'expiresAt': '2099-01-01T00:00:00Z',
                  };
                case '/users/fixture-user':
                  data = {
                    'id': 'fixture-user',
                    'firstName': 'Test',
                    'lastName': 'Customer',
                    'createdAt': '2026-01-01T00:00:00Z',
                    'updatedAt': '2026-01-01T00:00:00Z',
                  };
                case '/auth/logout':
                  data = <String, dynamic>{};
                default:
                  throw StateError('Unexpected endpoint ${options.path}');
              }
              handler.resolve(
                Response(
                  requestOptions: options,
                  statusCode: 200,
                  data: {'success': true, 'data': data},
                ),
              );
            },
          ),
        );
        final socket = QuietSocket();
        final container = ProviderContainer(
          overrides: [
            dioProvider.overrideWithValue(dio),
            cookieJarProvider.overrideWith(
              (ref) async => PersistCookieJar(storage: _MemoryStorage()),
            ),
            socketServiceProvider.overrideWithValue(socket),
            notificationServiceProvider.overrideWithValue(QuietNotifications()),
          ],
        );
        addTearDown(container.dispose);
        final auth = container.read(authProvider.notifier);
        await restored(container);
        expect(container.read(userProvider), isNull);
        await auth.signup(
          SignupRequest(
            firstName: 'Test',
            lastName: 'Customer',
            role: 'customer',
            email: channel == 'email' ? 'test@example.com' : null,
            phone: channel == 'phone' ? '+919876543210' : null,
          ),
        );
        expect(container.read(authProvider).status, AuthStatus.otpRequired);
        expect(
          await container.read(secureStorageProvider).read(key: 'auth_token'),
          isNull,
        );
        invalid = true;
        await auth.verifyOtp('000000');
        expect(container.read(authProvider).status, AuthStatus.otpRequired);
        expect(container.read(userProvider), isNull);
        invalid = false;
        await auth.verifyOtp('123456');
        expect(container.read(authProvider).status, AuthStatus.authenticated);
        expect(container.read(userProvider)?.id, 'fixture-user');
        await auth.checkAuthStatus();
        expect(container.read(authProvider).status, AuthStatus.authenticated);
        await auth.logout();
        expect(container.read(authProvider).status, AuthStatus.unauthenticated);
        expect(container.read(userProvider), isNull);
        await auth.login(
          LoginRequest(
            email: channel == 'email' ? 'test@example.com' : null,
            phone: channel == 'phone' ? '+919876543210' : null,
          ),
          channel,
        );
        expect(container.read(authProvider).status, AuthStatus.otpRequired);
        expect(
          await container.read(secureStorageProvider).read(key: 'auth_token'),
          isNull,
        );
        await auth.verifyOtp('123456');
        expect(container.read(authProvider).status, AuthStatus.authenticated);
        container.read(sessionRejectionProvider.notifier).state++;
        expect(container.read(authProvider).status, AuthStatus.unauthenticated);
        expect(container.read(userProvider), isNull);
        expect(socket.disconnects, greaterThan(0));
        expect(calls.where((call) => call.path.endsWith('/verify')).length, 3);
      },
    );
  }

  test(
    'temporary restoration failure preserves credentials for a validated retry',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        'auth_token': customerToken(),
        'user_id': 'fixture-user',
      });
      var available = false;
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            if (!available) {
              handler.reject(
                DioException(
                  requestOptions: options,
                  response: Response(requestOptions: options, statusCode: 503),
                ),
              );
            } else {
              handler.resolve(
                Response(
                  requestOptions: options,
                  statusCode: 200,
                  data: {
                    'data': {
                      'id': 'fixture-user',
                      'firstName': 'Test',
                      'lastName': 'Customer',
                      'createdAt': '2026-01-01T00:00:00Z',
                      'updatedAt': '2026-01-01T00:00:00Z',
                    },
                  },
                ),
              );
            }
          },
        ),
      );
      final container = ProviderContainer(
        overrides: [
          dioProvider.overrideWithValue(dio),
          socketServiceProvider.overrideWithValue(QuietSocket()),
          notificationServiceProvider.overrideWithValue(QuietNotifications()),
        ],
      );
      addTearDown(container.dispose);
      final auth = container.read(authProvider.notifier);
      await restored(container);
      expect(container.read(authProvider).status, AuthStatus.unauthenticated);
      expect(container.read(userProvider), isNull);
      expect(
        await container.read(secureStorageProvider).read(key: 'auth_token'),
        customerToken(),
      );
      available = true;
      await auth.checkAuthStatus();
      expect(container.read(authProvider).status, AuthStatus.authenticated);
    },
  );

  for (final status in [429, 503, 401, 403]) {
    test(
      'verified Google session profile HTTP $status preserves only retryable sessions',
      () async {
        FlutterSecureStorage.setMockInitialValues({});
        var available = false;
        final dio = Dio();
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              if (options.path == '/auth/google') {
                handler.resolve(
                  Response(
                    requestOptions: options,
                    statusCode: 200,
                    data: {
                      'data': {
                        'userId': 'fixture-user',
                        'accessToken': customerToken(),
                        'expiresAt': '2099-01-01T00:00:00Z',
                      },
                    },
                  ),
                );
              } else if (!available) {
                handler.reject(
                  DioException(
                    requestOptions: options,
                    response: Response(
                      requestOptions: options,
                      statusCode: status,
                    ),
                  ),
                );
              } else {
                handler.resolve(
                  Response(
                    requestOptions: options,
                    statusCode: 200,
                    data: {
                      'data': {
                        'id': 'fixture-user',
                        'firstName': 'Test',
                        'lastName': 'Customer',
                        'createdAt': '2026-01-01T00:00:00Z',
                        'updatedAt': '2026-01-01T00:00:00Z',
                      },
                    },
                  ),
                );
              }
            },
          ),
        );
        final container = ProviderContainer(
          overrides: [
            dioProvider.overrideWithValue(dio),
            socketServiceProvider.overrideWithValue(QuietSocket()),
            notificationServiceProvider.overrideWithValue(QuietNotifications()),
            cookieJarProvider.overrideWith(
              (ref) async => PersistCookieJar(storage: _MemoryStorage()),
            ),
          ],
        );
        addTearDown(container.dispose);
        final auth = container.read(authProvider.notifier);
        await restored(container);
        await auth.signInWithGoogle('fixture');
        expect(container.read(authProvider).status, AuthStatus.unauthenticated);
        expect(container.read(userProvider), isNull);
        final retryable = status == 429 || status == 503;
        expect(
          await container.read(secureStorageProvider).read(key: 'auth_token'),
          retryable ? customerToken() : null,
        );
        available = true;
        await auth.checkAuthStatus();
        expect(
          container.read(authProvider).status,
          retryable ? AuthStatus.authenticated : AuthStatus.unauthenticated,
        );
      },
    );
  }

  test('logout revokes server session despite device cleanup failure and cancels late auth', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final started = Completer<void>();
    late RequestInterceptorHandler googleHandler;
    late RequestOptions googleRequest;
    var logouts = 0;
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.path == '/auth/google') {
            googleHandler = handler;
            googleRequest = options;
            started.complete();
          } else if (options.path == '/auth/logout') {
            logouts++;
            handler.resolve(Response(requestOptions: options, statusCode: 204));
          } else {
            throw StateError(
              'Cancelled authentication must not load a profile',
            );
          }
        },
      ),
    );
    final container = ProviderContainer(
      overrides: [
        dioProvider.overrideWithValue(dio),
        cookieJarProvider.overrideWith(
          (ref) async => PersistCookieJar(storage: _MemoryStorage()),
        ),
        socketServiceProvider.overrideWithValue(QuietSocket()),
        notificationServiceProvider.overrideWithValue(_FailingDeviceCleanup()),
      ],
    );
    addTearDown(container.dispose);
    final auth = container.read(authProvider.notifier);
    await restored(container);
    final pending = auth.signInWithGoogle('fixture');
    await started.future;
    await auth.logout();
    expect(logouts, 1);
    googleHandler.resolve(
      Response(
        requestOptions: googleRequest,
        statusCode: 200,
        data: {
          'data': {
            'userId': 'fixture-user',
            'accessToken': customerToken(),
            'expiresAt': '2099-01-01T00:00:00Z',
          },
        },
      ),
    );
    await pending;
    expect(container.read(authProvider).status, AuthStatus.unauthenticated);
    expect(container.read(userProvider), isNull);
    expect(
      await container.read(secureStorageProvider).read(key: 'auth_token'),
      isNull,
    );
  });
}

class _FailingDeviceCleanup extends QuietNotifications {
  @override
  Future<void> unregisterDevice() async {
    throw StateError('Offline device cleanup');
  }
}

class _MemoryStorage implements Storage {
  final data = <String, String>{};
  @override
  Future<void> init(bool persistSession, bool ignoreExpires) async {}
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async {
    data[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    data.remove(key);
  }

  @override
  Future<void> deleteAll(List<String> keys) async {
    for (final key in keys) {
      data.remove(key);
    }
  }
}
