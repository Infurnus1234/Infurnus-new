import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/core/storage/secure_storage.dart';
import 'package:infurnus/features/auth/presentation/providers/auth_provider.dart';
import 'package:infurnus/features/auth/presentation/providers/user_provider.dart';

class _GoogleSocket extends SocketService {
  String? connectedToken;
  @override
  void connect(String token) {
    connectedToken = token;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const userId = '00000000-0000-4000-8000-000000000001';
  const googleFixture = 'google-id-token-fixture';
  final appFixture =
      'e30.${base64Url.encode(utf8.encode(jsonEncode({'sub': userId, 'role': 'customer'}))).replaceAll('=', '')}.fixture';

  for (final status in [200, 401, 409, 500, 0]) {
    final accepted = status == 200;
    test(
      'Google-only HTTP $status ${accepted ? 'establishes existing session' : 'rejects without a session'}',
      () async {
        FlutterSecureStorage.setMockInitialValues({});
        final requests = <RequestOptions>[];
        final dio = Dio(BaseOptions(baseUrl: 'http://localhost:3000'));
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              requests.add(options);
              if (options.path == '/auth/google') {
                if (!accepted) {
                  handler.reject(
                    DioException(
                      requestOptions: options,
                      type: status == 0 ? DioExceptionType.connectionError : DioExceptionType.badResponse,
                      response: status == 0 ? null : Response(
                        requestOptions: options,
                        statusCode: status,
                        data: {
                          'error': {
                            'code': status == 409 ? 'GOOGLE_ACCOUNT_LINK_CONFLICT' : 'GOOGLE_AUTH_ERROR',
                            'message': status == 409 ? 'Authenticate and explicitly link your existing account' : 'Google authentication rejected',
                          },
                        },
                      ),
                    ),
                  );
                } else {
                  handler.resolve(
                    Response(
                      requestOptions: options,
                      statusCode: 200,
                      data: {
                        'success': true,
                        'data': {
                          'userId': userId,
                          'accessToken': appFixture,
                          'expiresAt': '2030-01-01T00:00:00Z',
                        },
                      },
                    ),
                  );
                }
              } else if (options.path == '/users/$userId') {
                handler.resolve(
                  Response(
                    requestOptions: options,
                    statusCode: 200,
                    data: {
                      'data': {
                        'id': userId,
                        'firstName': 'Google',
                        'lastName': 'Fixture',
                        'createdAt': '2026-01-01T00:00:00Z',
                        'updatedAt': '2026-01-01T00:00:00Z',
                      },
                    },
                  ),
                );
              } else {
                handler.reject(
                  DioException(
                    requestOptions: options,
                    error: 'Unexpected request',
                  ),
                );
              }
            },
          ),
        );
        final socket = _GoogleSocket();
        final container = ProviderContainer(
          overrides: [
            dioProvider.overrideWithValue(dio),
            socketServiceProvider.overrideWithValue(socket),
          ],
        );
        try {
          final notifier = container.read(authProvider.notifier);
          for (
            var i = 0;
            i < 10 && container.read(authProvider).status == AuthStatus.initial;
            i++
          ) {
            await Future<void>.delayed(Duration.zero);
          }
          await notifier.signInWithGoogle(googleFixture);
          expect(requests.first.method, 'POST');
          expect(
            requests.first.uri.toString(),
            'http://localhost:3000/auth/google',
          );
          expect(requests.first.data, {'idToken': googleFixture});
          expect(requests.first.extra['withCredentials'], isTrue);
          final storage = container.read(secureStorageProvider);
          if (accepted) {
            expect(
              container.read(authProvider).status,
              AuthStatus.authenticated,
            );
            expect(await storage.read(key: 'auth_token'), appFixture);
            expect(await storage.read(key: 'user_id'), userId);
            expect(await storage.read(key: 'user_role'), 'customer');
            expect(container.read(userProvider)?.id, userId);
            expect(socket.connectedToken, appFixture);
          } else {
            expect(
              container.read(authProvider).status,
              AuthStatus.unauthenticated,
            );
            expect(await storage.read(key: 'auth_token'), isNull);
            expect(socket.connectedToken, isNull);
            if (status == 409) {
              expect(container.read(authProvider).errorMessage, contains('explicitly link'));
            }
            if (status == 0) {
              expect(container.read(authProvider).errorMessage, contains('local server'));
            }
            expect(requests.length, 1);
          }
        } finally {
          container.dispose();
          socket.dispose();
          dio.close();
        }
      },
    );
  }
}
