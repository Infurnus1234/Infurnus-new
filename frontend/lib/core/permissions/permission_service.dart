import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';

import '../services/location_access.dart';

class PermissionService {
  Future<bool> _request(Permission permission) async {
    final current = await permission.status;
    if (current.isGranted) return true;
    if (current.isPermanentlyDenied || current.isRestricted) return false;
    return (await permission.request()).isGranted;
  }

  Future<bool> requestLocationPermission() async {
    final issue = await locationAccess.check(retry: true);
    return issue == null;
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
