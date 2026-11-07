import 'dart:async';

import 'package:geolocator/geolocator.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'location_access.dart';

class LocationUnavailableException implements Exception {
  final String message;
  final bool settingsRequired;
  final bool locationSettingsRequired;

  const LocationUnavailableException(
    this.message, {
    this.settingsRequired = false,
    this.locationSettingsRequired = false,
  });

  @override
  String toString() => message;
}

class LocationService {
  Future<Position?>? _pendingPosition;

  Future<Position?> getCurrentPosition({bool retry = false}) {
    return _pendingPosition ??= _readCurrentPosition(retry: retry)
        .whenComplete(() => _pendingPosition = null);
  }

  Future<Position?> _readCurrentPosition({required bool retry}) async {
    final issue = await locationAccess.check(retry: retry);
    if (issue != null) {
      throw LocationUnavailableException(
        issue.message,
        settingsRequired: issue == LocationAccessIssue.permissionBlocked,
        locationSettingsRequired:
            issue == LocationAccessIssue.resolutionUnavailable,
      );
    }

    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      if (kDebugMode) debugPrint('Location: current GPS fix received');
      return position;
    } on TimeoutException {
      throw const LocationUnavailableException(
        'Getting your location timed out. Check GPS signal and try again.',
      );
    } on LocationServiceDisabledException {
      throw const LocationUnavailableException(
        'Location services are disabled. Enable GPS and try again.',
      );
    } on Exception {
      throw const LocationUnavailableException(
        'Your current location is unavailable. Check GPS and try again.',
      );
    }
  }

  Stream<Position> getPositionStream() {
    return Geolocator.getPositionStream(
      locationSettings: defaultTargetPlatform == TargetPlatform.iOS
          ? AppleSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 10,
              allowBackgroundLocationUpdates: false,
            )
          : const LocationSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 10,
            ),
    );
  }

  Future<bool> openAppSettings() => Geolocator.openAppSettings();
  Future<bool> openLocationSettings() => Geolocator.openLocationSettings();
}

final locationServiceProvider = Provider((ref) => LocationService());
