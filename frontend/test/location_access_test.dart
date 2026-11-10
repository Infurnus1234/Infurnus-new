import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:infurnus/core/services/location_access.dart';

class TestLocationPlatform extends GeolocatorPlatform {
  LocationPermission permission = LocationPermission.denied;
  LocationPermission answer = LocationPermission.whileInUse;
  bool enabled = true;
  int requests = 0;
  final service = StreamController<ServiceStatus>.broadcast();

  @override
  Future<LocationPermission> checkPermission() async => permission;

  @override
  Future<LocationPermission> requestPermission() async {
    requests++;
    if (answer == LocationPermission.whileInUse) permission = answer;
    return answer;
  }

  @override
  Future<bool> isLocationServiceEnabled() async => enabled;

  @override
  Stream<ServiceStatus> getServiceStatusStream() => service.stream;
}

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('infurnus/location_settings');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late TestLocationPlatform platform;
  late LocationAccess access;
  late int resolutions;
  late bool approveResolution;

  setUp(() {
    final previous = GeolocatorPlatform.instance;
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    platform = TestLocationPlatform();
    GeolocatorPlatform.instance = platform;
    access = LocationAccess();
    resolutions = 0;
    approveResolution = true;
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'isEnabled') return platform.enabled;
      expect(call.method, 'resolve');
      resolutions++;
      if (!approveResolution) return 'cancelled';
      platform.enabled = true;
      return 'enabled';
    });
    addTearDown(() async {
      await access.dispose();
      await platform.service.close();
      messenger.setMockMethodCallHandler(channel, null);
      GeolocatorPlatform.instance = previous;
      debugDefaultTargetPlatformOverride = null;
    });
  });

  test('permission and GPS approval unblock all waiting consumers', () async {
    platform.enabled = false;
    final one = access.check();
    final two = access.check();
    expect(identical(one, two), isTrue);
    expect(await one, isNull);
    expect(await two, isNull);
    expect(platform.requests, 1);
    expect(resolutions, 1);
    expect(await access.check(), isNull);
    expect(platform.requests, 1);
    expect(resolutions, 1);
  });

  test(
    'the OS can expire a temporary permission and request it again',
    () async {
      expect(await access.check(), isNull);
      expect(await access.check(), isNull);
      expect(platform.requests, 1);
      platform.permission = LocationPermission.denied;
      expect(await access.check(), isNull);
      expect(platform.requests, 2);
    },
  );

  test(
    'a denial waits for retry and a blocked grant can recover in Settings',
    () async {
      platform.answer = LocationPermission.denied;
      expect(await access.check(), LocationAccessIssue.permissionDenied);
      expect(await access.check(), LocationAccessIssue.permissionDenied);
      expect(platform.requests, 1);
      platform.answer = LocationPermission.deniedForever;
      expect(
        await access.check(retry: true),
        LocationAccessIssue.permissionBlocked,
      );
      expect(
        await access.check(retry: true),
        LocationAccessIssue.permissionBlocked,
      );
      expect(platform.requests, 2);
      platform.permission = LocationPermission.whileInUse;
      expect(await access.check(), isNull);
    },
  );

  test(
    'dismissing GPS resolution requires a new event or a deliberate retry',
    () async {
      platform.permission = LocationPermission.whileInUse;
      platform.enabled = false;
      approveResolution = false;
      expect(await access.check(), LocationAccessIssue.servicesOff);
      expect(await access.check(), LocationAccessIssue.servicesOff);
      expect(resolutions, 1);
      approveResolution = true;
      expect(await access.check(retry: true), isNull);
      expect(resolutions, 2);
      expect(platform.requests, 0);
    },
  );

  test('GPS switched off while foregrounded triggers recovery', () async {
    binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    platform.permission = LocationPermission.whileInUse;
    access.start();
    expect(await access.check(), isNull);
    final events = access.changes.take(2).toList();
    platform.enabled = false;
    platform.service.add(ServiceStatus.disabled);
    expect(await events, [LocationAccessIssue.servicesOff, null]);
    expect(resolutions, 1);
    expect(platform.requests, 0);
  });

  test(
    'a device without the native resolution supports the settings fallback',
    () async {
      platform.enabled = false;
      platform.permission = LocationPermission.whileInUse;
      messenger.setMockMethodCallHandler(
        channel,
        (call) async => call.method == 'isEnabled' ? false : 'unavailable',
      );
      expect(await access.check(), LocationAccessIssue.resolutionUnavailable);
    },
  );
}
