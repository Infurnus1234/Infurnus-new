import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/features/auth/data/models/auth_models.dart';
import 'package:infurnus/features/auth/presentation/providers/auth_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final succeeds in [true, false]) {
    test('resend serializes requests and reports success=$succeeds', () async {
      FlutterSecureStorage.setMockInitialValues({});
      final pending = Completer<void>();
      final started = Completer<void>();
      var sends = 0;
      final dio = Dio(BaseOptions(baseUrl: 'https://backend.example'));
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) async {
            if (options.path == '/auth/login') {
              handler.resolve(
                Response(
                  requestOptions: options,
                  statusCode: 200,
                  data: {
                    'success': true,
                    'data': {
                      'challengeId': 'challenge',
                      'expiresAt': '2099-01-01T00:00:00Z',
                    },
                  },
                ),
              );
              return;
            }
            expect(options.path, '/auth/login/resend');
            sends++;
            started.complete();
            await pending.future;
            if (succeeds) {
              handler.resolve(
                Response(
                  requestOptions: options,
                  statusCode: 200,
                  data: {
                    'success': true,
                    'data': {
                      'challengeId': 'challenge',
                      'expiresAt': '2099-01-01T00:00:00Z',
                    },
                  },
                ),
              );
            } else {
              handler.reject(
                DioException(
                  requestOptions: options,
                  response: Response(
                    requestOptions: options,
                    statusCode: 502,
                    data: {
                      'error': {'message': 'Verification service unavailable'},
                    },
                  ),
                ),
              );
            }
          },
        ),
      );
      final container = ProviderContainer(
        overrides: [dioProvider.overrideWithValue(dio)],
      );
      addTearDown(container.dispose);
      final notifier = container.read(authProvider.notifier);
      await Future<void>.delayed(Duration.zero);
      await notifier.login(LoginRequest(phone: '+919876543210'), 'phone');
      expect(container.read(authProvider).status, AuthStatus.otpRequired);
      final first = notifier.resendOtp();
      await started.future;
      expect(container.read(authProvider).status, AuthStatus.loading);
      expect(await notifier.resendOtp(), isFalse);
      await notifier.verifyOtp('123456');
      expect(sends, 1);
      pending.complete();
      expect(await first, succeeds);
      final state = container.read(authProvider);
      expect(state.status, AuthStatus.otpRequired);
      expect(state.errorMessage, succeeds ? isNull : isNotEmpty);
      expect(state.loginChallengeId, 'challenge');
    });
  }
}
