import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/app/router/router.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/storage/secure_storage.dart';
import 'package:infurnus/core/services/notification_service.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/auth/data/models/auth_models.dart';
import 'package:infurnus/features/auth/presentation/providers/auth_provider.dart';
import 'package:infurnus/features/auth/presentation/providers/user_provider.dart';

import 'mandatory_auth_test.dart'
    show QuietSocket, QuietNotifications, restored;

class _RealHttp extends HttpOverrides {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const url = String.fromEnvironment('AUTH_BACKEND_TEST_URL');
  const email = String.fromEnvironment('AUTH_TEST_EMAIL');
  test('actual backend email signup/login/session restore/logout with real AuthNotifier', () async {
    expect(Uri.parse(url).host, '127.0.0.1');
    expect(email, startsWith('frontend-auth-'));
    FlutterSecureStorage.setMockInitialValues({});
    final directory = await Directory.systemTemp.createTemp(
      'infurnus-email-session-',
    );
    final jar = PersistCookieJar(storage: FileStorage(directory.path));
    final containers = <ProviderContainer>[];
    ProviderContainer open() {
      final container = ProviderContainer(
        overrides: [
          cookieJarProvider.overrideWith((ref) async => jar),
          socketServiceProvider.overrideWithValue(QuietSocket()),
          notificationServiceProvider.overrideWithValue(QuietNotifications()),
        ],
      );
      containers.add(container);
      final dio = container.read(dioProvider);
      dio.options.baseUrl = url;
      dio.httpClientAdapter = IOHttpClientAdapter(
        createHttpClient: () => _RealHttp().createHttpClient(null),
      );
      return container;
    }

    try {
      final container = open();
      final auth = container.read(authProvider.notifier);
      await restored(container);
      await auth.signup(
        SignupRequest(
          firstName: 'Email',
          lastName: 'Fixture',
          email: email,
          role: 'customer',
        ),
      );
      expect(container.read(authProvider).status, AuthStatus.otpRequired);
      expect(container.read(authProvider).loginChannel, 'email');
      expect(container.read(userProvider), isNull);
      expect(
        await container.read(secureStorageProvider).read(key: 'auth_token'),
        isNull,
      );
      await auth.verifyOtp('000000');
      expect(container.read(authProvider).status, AuthStatus.otpRequired);
      expect(container.read(userProvider), isNull);
      await auth.verifyOtp(
        '123456',
      ); // Only the isolated harness supplies this delivery fixture.
      expect(
        container.read(authProvider).status,
        AuthStatus.authenticated,
        reason: container.read(authProvider).errorMessage,
      );
      final id = container.read(userProvider)!.id;
      expect(container.read(userProvider)!.email, email);
      expect(
        authRedirect(container.read(authProvider), '/login', 'customer'),
        '/customer-home',
      );
      final token = await container
          .read(secureStorageProvider)
          .read(key: 'auth_token');
      expect(token, isNotEmpty);
      final restarted = open();
      restarted.read(authProvider);
      await restored(restarted);
      expect(restarted.read(authProvider).status, AuthStatus.authenticated);
      expect(restarted.read(userProvider)!.id, id);
      await restarted.read(authProvider.notifier).logout();
      expect(restarted.read(authProvider).status, AuthStatus.unauthenticated);
      expect(
        authRedirect(restarted.read(authProvider), '/customer-home', null),
        '/login',
      );
      expect(await jar.loadForRequest(Uri.parse('$url/auth')), isEmpty);
      // A revoked sid-bound credential cannot be used independently of the frontend.
      await expectLater(
        container
            .read(dioProvider)
            .get(
              '/users/$id',
              options: Options(headers: {'Authorization': 'Bearer $token'}),
            ),
        throwsA(isA<DioException>()),
      );
      await auth.login(LoginRequest(email: email), 'email');
      expect(container.read(authProvider).status, AuthStatus.otpRequired);
      expect(
        await container.read(secureStorageProvider).read(key: 'auth_token'),
        isNull,
      );
      await auth.verifyOtp('000000');
      expect(container.read(authProvider).status, AuthStatus.otpRequired);
      await auth.verifyOtp('123456');
      expect(
        container.read(authProvider).status,
        AuthStatus.authenticated,
        reason: container.read(authProvider).errorMessage,
      );
      expect(
        container.read(userProvider)!.id,
        id,
        reason: 'Existing login must not create a duplicate account',
      );
      await auth.logout();
      expect(container.read(userProvider), isNull);
      final clean = open();
      clean.read(authProvider);
      await restored(clean);
      expect(clean.read(authProvider).status, AuthStatus.unauthenticated);
    } finally {
      for (final container in containers) {
        container.read(dioProvider).close(force: true);
        container.dispose();
      }
      await directory.delete(recursive: true);
    }
  }, skip: url.isEmpty || email.isEmpty);
}
