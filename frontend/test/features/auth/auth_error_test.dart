import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/features/auth/data/models/auth_models.dart';
import 'package:infurnus/features/auth/presentation/providers/auth_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final errors = <Object>[
    {'error': 'Proxy failure'},
    {'error': <Object>[]},
    {
      'error': {'message': 123},
    },
    {
      'error': {'message': 'Invalid credentials'},
    },
  ];
  for (var index = 0; index < errors.length; index++) {
    test('Login error payload $index exits loading without throwing', () async {
      FlutterSecureStorage.setMockInitialValues({});
      final dio = Dio(BaseOptions(baseUrl: 'http://localhost:3000'));
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.badResponse,
                response: Response(
                  requestOptions: options,
                  statusCode: 401,
                  data: errors[index],
                ),
              ),
            );
          },
        ),
      );
      final container = ProviderContainer(
        overrides: [dioProvider.overrideWithValue(dio)],
      );
      addTearDown(container.dispose);
      final notifier = container.read(authProvider.notifier);
      await Future<void>.delayed(Duration.zero);
      await notifier.login(
        LoginRequest(
          email: 'fixture@example.com',
          password: 'invalid-password',
        ),
        'email',
      );
      final state = container.read(authProvider);
      expect(state.status, AuthStatus.unauthenticated);
      expect(state.errorMessage, isNotEmpty);
      if (index == 3) expect(state.errorMessage, 'Invalid credentials');
      expect(
        await const FlutterSecureStorage().read(key: 'auth_token'),
        isNull,
      );
    });
  }
}
