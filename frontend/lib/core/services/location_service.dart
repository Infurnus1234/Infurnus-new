import 'dart:async';

import 'package:geolocator/geolocator.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class LocationUnavailableException implements Exception {
  final String message;

  const LocationUnavailableException(this.message);

  @override
  String toString() => message;
}

class LocationService {
  Future<Position?> getCurrentPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw const LocationUnavailableException(
        'Location services are disabled. Enable GPS and try again.',
      );
    }

    var permission = await Geolocator.checkPermission();
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
      );
    }
    if (permission != LocationPermission.whileInUse &&
        permission != LocationPermission.always) {
      throw const LocationUnavailableException(
        'Location permission is unavailable. Allow location access and try again.',
      );
    }

    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
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
}

final locationServiceProvider = Provider((ref) => LocationService());
