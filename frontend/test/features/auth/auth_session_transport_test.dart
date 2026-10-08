import 'dart:convert';
import 'dart:io';

import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/storage/secure_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late HttpServer server;
  late Directory directory;
  late ProviderContainer container;
  late Dio dio;
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({
      'auth_token': 'old-fixture',
      'user_id': 'fixture-user',
      'user_role': 'customer',
    });
    directory = await Directory.systemTemp.createTemp('infurnus-auth-cookies-');
    final jar = PersistCookieJar(storage: FileStorage(directory.path));
    container = ProviderContainer(
      overrides: [cookieJarProvider.overrideWith((ref) async => jar)],
    );
    dio = container.read(dioProvider);
    dio.httpClientAdapter = IOHttpClientAdapter(createHttpClient: () => _RealHttpOverrides().createHttpClient(null));
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    dio.options.baseUrl = 'http://127.0.0.1:${server.port}';
  });
  tearDown(() async {
    dio.close(force: true);
    await server.close(force: true);
    container.dispose();
    await directory.delete(recursive: true);
  });

  test('first authentication response saves refresh/CSRF cookies and logout sends them', () async {
    server.listen((request) async {
      if (request.uri.path == '/auth/google') {
        request.response.cookies.add(
          Cookie('infurnus_refresh_token', 'refresh-fixture')
            ..httpOnly = true
            ..path = '/auth',
        );
        request.response.cookies.add(
          Cookie('infurnus_csrf_token', 'csrf-fixture')..path = '/auth',
        );
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          jsonEncode({
            'data': {'csrfToken': 'csrf-fixture'},
          }),
        );
      } else {
        expect(
          request.cookies.any(
            (cookie) =>
                cookie.name == 'infurnus_refresh_token' &&
                cookie.value == 'refresh-fixture',
          ),
          isTrue,
        );
        expect(request.headers.value('X-CSRF-Token'), 'csrf-fixture');
        request.response.statusCode = 204;
      }
      await request.response.close();
    });
    await dio.post('/auth/google', data: {'idToken': 'fixture'});
    expect(
      await container.read(secureStorageProvider).read(key: 'auth_csrf_token'),
      'csrf-fixture',
    );
    expect((await dio.post('/auth/logout')).statusCode, 204);
  });

  test('two expired access requests use one refresh and retry with the rotated token', () async {
    var refreshes = 0;
    server.listen((request) async {
      request.response.headers.contentType = ContentType.json;
      if (request.uri.path == '/auth/refresh') {
        refreshes++;
        await Future<void>.delayed(const Duration(milliseconds: 80));
        request.response.write(
          jsonEncode({
            'data': {'accessToken': 'rotated-fixture'},
          }),
        );
      } else if (request.headers.value('Authorization') ==
          'Bearer rotated-fixture') {
        request.response.write('{}');
      } else {
        request.response.statusCode = 401;
        request.response.write('{}');
      }
      await request.response.close();
    });
    final responses = await Future.wait([
      dio.get('/protected'),
      dio.get('/protected'),
    ]);
    expect(responses.every((response) => response.statusCode == 200), isTrue);
    expect(refreshes, 1);
    expect(
      await container.read(secureStorageProvider).read(key: 'auth_token'),
      'rotated-fixture',
    );
  });

  for (final status in [401, 503]) {
    test(
      'refresh HTTP $status ${status == 401 ? 'invalidates' : 'preserves'} local authentication',
      () async {
        server.listen((request) async {
          request.response.statusCode = request.uri.path == '/auth/refresh'
              ? status
              : 401;
          request.response.headers.contentType = ContentType.json;
          request.response.write('{}');
          await request.response.close();
        });
        await expectLater(dio.get('/protected'), throwsA(isA<DioException>()));
        expect(
          await container.read(secureStorageProvider).read(key: 'auth_token'),
          status == 401 ? isNull : 'old-fixture',
        );
      },
    );
  }
  for (final path in [
    '/auth/google',
    '/auth/login',
    '/auth/signup',
    '/auth/forgot-password/verify',
    '/auth/reset-password',
  ]) {
    test('$path rejection does not attempt session refresh', () async {
      final paths = <String>[];
      server.listen((request) async {
        paths.add(request.uri.path);
        request.response.statusCode = 401;
        request.response.headers.contentType = ContentType.json;
        request.response.write('{}');
        await request.response.close();
      });
      await expectLater(dio.post(path), throwsA(isA<DioException>()));
      expect(paths, [path]);
      expect(
        await container.read(secureStorageProvider).read(key: 'auth_token'),
        'old-fixture',
      );
    });
  }
}

class _RealHttpOverrides extends HttpOverrides {}
