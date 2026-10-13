import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class PermissionService {
  Future<void> requestStartupLocation() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return;
    const storage = FlutterSecureStorage();
    if (await storage.read(key: 'startup_location_requested') == 'true') return;
    await storage.write(key: 'startup_location_requested', value: 'true');
    await requestLocationPermission();
  }

  Future<bool> _request(Permission permission) async {
    final current = await permission.status;
    if (current.isGranted) return true;
    if (current.isPermanentlyDenied || current.isRestricted) return false;
    return (await permission.request()).isGranted;
  }

  Future<bool> requestLocationPermission() async {
    return _request(Permission.locationWhenInUse);
  }

  Future<bool> requestNotificationPermission() async {
    return _request(Permission.notification);
  }

  Future<bool> requestCameraPermission() async {
    return _request(Permission.camera);
  }

  Future<bool> isLocationEnabled() async {
    return await Geolocator.isLocationServiceEnabled();
  }
}
