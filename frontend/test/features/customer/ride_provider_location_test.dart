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

class _RecordingGeocodingService extends GeocodingService {
  final queries = <String>[];

  @override
  Future<LatLng?> geocodeAddress(String query) async {
    queries.add(query);
    return null;
  }
}

void main() {
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
