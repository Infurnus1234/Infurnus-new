import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/core/storage/secure_storage.dart';
import 'package:infurnus/features/auth/presentation/providers/auth_provider.dart';

class TestSocket extends SocketService {
  @override
  void connect(String token) {}
  @override
  void disconnect() {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final succeeds in [true, false]) {
    test(
      'account deletion ${succeeds ? 'clears session after confirmation' : 'preserves session on backend failure'}',
      () async {
        FlutterSecureStorage.setMockInitialValues({});
        const id = '00000000-0000-4000-8000-000000000001';
        final token =
            'e30.${base64Url.encode(utf8.encode(jsonEncode({'sub': id, 'role': 'customer'}))).replaceAll('=', '')}.fixture';
        final requests = <RequestOptions>[];
        final dio = Dio();
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              requests.add(options);
              if (options.path == '/auth/google') {
                handler.resolve(
                  Response(
                    requestOptions: options,
                    statusCode: 200,
                    data: {
                      'success': true,
                      'data': {
                        'userId': id,
                        'expiresAt': '2030-01-01T00:00:00Z',
                        'accessToken': token,
                      },
                    },
                  ),
                );
              } else if (options.path == '/users/$id') {
                handler.resolve(
                  Response(
                    requestOptions: options,
                    statusCode: 200,
                    data: {
                      'data': {
                        'id': id,
                        'firstName': 'TEST',
                        'lastName': 'Fixture',
                        'createdAt': '2026-01-01T00:00:00Z',
                        'updatedAt': '2026-01-01T00:00:00Z',
                      },
                    },
                  ),
                );
              } else if (options.path == '/auth/account' && succeeds) {
                handler.resolve(
                  Response(
                    requestOptions: options,
                    statusCode: 200,
                    data: {'success': true},
                  ),
                );
              } else {
                handler.reject(
                  DioException(
                    requestOptions: options,
                    type: DioExceptionType.badResponse,
                    response: Response(
                      requestOptions: options,
                      statusCode: 503,
                      data: {
                        'error': {
                          'message': 'Deletion temporarily unavailable',
                        },
                      },
                    ),
                  ),
                );
              }
            },
          ),
        );
        final container = ProviderContainer(
          overrides: [
            dioProvider.overrideWithValue(dio),
            socketServiceProvider.overrideWithValue(TestSocket()),
          ],
        );
        addTearDown(container.dispose);
        final notifier = container.read(authProvider.notifier);
        for (
          var i = 0;
          i < 12 && container.read(authProvider).status == AuthStatus.initial;
          i++
        ) {
          await Future<void>.delayed(Duration.zero);
        }
        await notifier.signInWithGoogle('TEST_ONLY_GOOGLE_FIXTURE');
        expect(container.read(authProvider).status, AuthStatus.authenticated);
        expect(await notifier.deleteAccount(), succeeds);
        expect(requests.last.path, '/auth/account');
        expect(requests.last.method, 'DELETE');
        expect(
          container.read(authProvider).status,
          succeeds ? AuthStatus.unauthenticated : AuthStatus.authenticated,
        );
        expect(
          await container.read(secureStorageProvider).read(key: 'auth_token'),
          succeeds ? null : token,
        );
        if (!succeeds) {
          expect(
            container.read(authProvider).errorMessage,
            'Deletion temporarily unavailable',
          );
        }
      },
    );
  }
}
