import 'dart:async';

import 'package:geolocator/geolocator.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class LocationUnavailableException implements Exception {
  final String message;
  final bool settingsRequired;

  const LocationUnavailableException(
    this.message, {
    this.settingsRequired = false,
  });

  @override
  String toString() => message;
}

class LocationService {
  Future<Position?>? _pendingPosition;

  Future<Position?> getCurrentPosition() {
    return _pendingPosition ??= _readCurrentPosition()
        .timeout(
          const Duration(seconds: 20),
          onTimeout: () {
            throw const LocationUnavailableException(
              'Getting your location timed out. Check location permission and GPS, then retry.',
            );
          },
        )
        .whenComplete(() => _pendingPosition = null);
  }

  Future<Position?> _readCurrentPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (kDebugMode) debugPrint('Location: service enabled=$serviceEnabled');
    if (!serviceEnabled) {
      throw const LocationUnavailableException(
        'Location services are disabled. Enable GPS and try again.',
      );
    }

    var permission = await Geolocator.checkPermission();
    if (kDebugMode) debugPrint('Location: permission=${permission.name}');
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        throw const LocationUnavailableException(
          'Location permission was denied. Allow location access and try again.',
        );
      }
    }

    if (permission == LocationPermission.deniedForever) {
      throw const LocationUnavailableException(
        'Location permission is blocked. Enable it in your device settings.',
        settingsRequired: true,
      );
    }
    if (permission != LocationPermission.whileInUse &&
        permission != LocationPermission.always) {
      throw const LocationUnavailableException(
        'Location permission is unavailable. Allow location access and try again.',
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
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
      ),
    );
  }

  Future<bool> openAppSettings() => Geolocator.openAppSettings();
}

final locationServiceProvider = Provider((ref) => LocationService());
