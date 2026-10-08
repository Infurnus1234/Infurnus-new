import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import 'package:infurnus/core/services/geocoding_service.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';

class _UnavailableLocationService extends LocationService {
  @override
  Future<Position?> getCurrentPosition() async => null;
}

class _GpsPlatform extends GeolocatorPlatform {
  LocationPermission permission = LocationPermission.whileInUse;
  final fix = Completer<Position>();
  int requests = 0;
  int fixes = 0;
  @override
  Future<bool> isLocationServiceEnabled() async => true;
  @override
  Future<LocationPermission> checkPermission() async => permission;
  @override
  Future<LocationPermission> requestPermission() async {
    requests++;
    return LocationPermission.deniedForever;
  }

  @override
  Future<Position> getCurrentPosition({LocationSettings? locationSettings}) {
    fixes++;
    return fix.future;
  }
}

class _RecordingGeocodingService extends GeocodingService {
  final queries = <String>[];

  @override
  Future<LatLng?> geocodeAddress(String query) async {
    queries.add(query);
    return null;
  }
}

void main() {
  test(
    'standby requires a selected pickup instead of invented coordinates',
    () async {
      final geocodingService = _RecordingGeocodingService();
      final container = ProviderContainer(
        overrides: [
          geocodingServiceProvider.overrideWithValue(geocodingService),
        ],
      );
      addTearDown(container.dispose);
      final notifier = container.read(rideProvider.notifier);
      expect(
        await notifier.geocodeAndSetDestination('Hourly standby'),
        isFalse,
      );
      expect(container.read(rideProvider).destinationCoords, isNull);
      expect(
        container.read(rideProvider).errorMessage,
        'Select a pickup location first.',
      );
      expect(geocodingService.queries, isEmpty);
    },
  );
  test('concurrent map and pickup reads share one GPS request', () async {
    final previous = GeolocatorPlatform.instance;
    final gps = _GpsPlatform();
    GeolocatorPlatform.instance = gps;
    addTearDown(() => GeolocatorPlatform.instance = previous);
    final service = LocationService();
    final one = service.getCurrentPosition();
    final two = service.getCurrentPosition();
    expect(identical(one, two), isTrue);
    await Future<void>.delayed(Duration.zero);
    expect(gps.fixes, 1);
    gps.fix.complete(
      Position(
        latitude: 25,
        longitude: 85,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    expect(await one, same(await two));
  });
  test(
    'permanently denied permission offers settings and never reads GPS',
    () async {
      final previous = GeolocatorPlatform.instance;
      final gps = _GpsPlatform()..permission = LocationPermission.denied;
      GeolocatorPlatform.instance = gps;
      addTearDown(() => GeolocatorPlatform.instance = previous);
      await expectLater(
        LocationService().getCurrentPosition(),
        throwsA(
          isA<LocationUnavailableException>().having(
            (e) => e.settingsRequired,
            'settings',
            isTrue,
          ),
        ),
      );
      expect(gps.requests, 1);
      expect(gps.fixes, 0);
    },
  );
  test('does not geocode Current Location when GPS is unavailable', () async {
    final geocodingService = _RecordingGeocodingService();
    final container = ProviderContainer(
      overrides: [
        locationServiceProvider.overrideWithValue(
          _UnavailableLocationService(),
        ),
        geocodingServiceProvider.overrideWithValue(geocodingService),
      ],
    );
    addTearDown(container.dispose);

    final located = await container
        .read(rideProvider.notifier)
        .geocodeAndSetPickup('Current Location');

    expect(located, isFalse);
    expect(geocodingService.queries, isEmpty);
    expect(container.read(rideProvider).errorMessage, contains('location'));
  });
}
