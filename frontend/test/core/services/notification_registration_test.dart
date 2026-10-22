import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/services/notification_service.dart';
import 'package:infurnus/features/auth/data/models/auth_models.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('customer identity is explicit for both phone and email login', () {
    expect(LoginRequest(phone: '+918000000001').toJson()['role'], 'customer');
    expect(
      LoginRequest(email: 'fixture@example.invalid').toJson()['role'],
      'customer',
    );
  });
  test(
    'real SDK token uses device API and logout deletes owned device record',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        'auth_token': 'fixture',
        'device_id': 'fixture-device',
      });
      final requests = <RequestOptions>[];
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (r, h) {
            requests.add(r);
            h.resolve(
              Response(
                requestOptions: r,
                statusCode: 200,
                data: {
                  'data': {'id': 'fixture-record'},
                },
              ),
            );
          },
        ),
      );
      final notifications = NotificationService(dio);
      await notifications.registerDeviceToken('sdk-token-fixture');
      expect(requests.single.path, '/notifications/devices');
      expect(requests.single.data, {
        'fcmToken': 'sdk-token-fixture',
        'platform': 'ANDROID',
        'deviceId': 'fixture-device',
      });
      await notifications.unregisterDevice();
      expect(requests.last.method, 'DELETE');
      expect(requests.last.path, '/notifications/devices/fixture-record');
      expect(
        await const FlutterSecureStorage().read(key: 'push_device_record_id'),
        null,
      );
      dio.close();
    },
  );
  test('signed-out devices and empty tokens are never registered', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(onRequest: (r, h) => fail('Unexpected registration')),
    );
    final notifications = NotificationService(dio);
    await notifications.registerDeviceToken('sdk-token-fixture');
    await notifications.registerDeviceToken('');
    dio.close();
  });
}
