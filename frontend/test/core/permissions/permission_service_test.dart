import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/permissions/permission_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('flutter.baseflow.com/permissions/methods');
  var status = 0, requests = 0;
  setUp(() {
    status = 0;
    requests = 0;
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    FlutterSecureStorage.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method == 'checkPermissionStatus') return status;
          if (call.method == 'requestPermissions') {
            requests++;
            return {
              for (final permission in call.arguments as List)
                permission: status,
            };
          }
          return null;
        });
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });
  test('granted location does not request again', () async {
    status = 1;
    expect(await PermissionService().requestLocationPermission(), true);
    expect(requests, 0);
  });
  test(
    'denied permission remains usable and requests only on explicit call',
    () async {
      expect(await PermissionService().requestLocationPermission(), false);
      expect(requests, 1);
    },
  );
  test('permanently denied permission is not requested repeatedly', () async {
    status = 4;
    expect(await PermissionService().requestLocationPermission(), false);
    expect(requests, 0);
  });
  test('restricted permission is not requested', () async {
    status = 2;
    expect(await PermissionService().requestCameraPermission(), false);
    expect(requests, 0);
  });
  test('startup requests once across subsequent launches', () async {
    await PermissionService().requestStartupLocation();
    await PermissionService().requestStartupLocation();
    expect(requests, 1);
  });
}
