import 'dart:async';

import 'package:dio/dio.dart';
import 'package:infurnus/core/network/dio_client.dart';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/core/services/geocoding_service.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/pickup_selection_screen.dart';

import 'vehicle_fare_ranges_test.dart'
    show RecordingRepository, ConnectedSocket, range;

Dio mapFixture() => Dio()
  ..interceptors.add(
    InterceptorsWrapper(
      onRequest: (request, handler) {
        handler.resolve(
          Response(
            requestOptions: request,
            statusCode: 200,
            data: {'data': <String, dynamic>{}},
          ),
        );
      },
    ),
  );

class PendingGps extends LocationService {
  final fix = Completer<Position?>();
  int reads = 0;
  @override
  Future<Position?> getCurrentPosition() {
    reads++;
    return fix.future;
  }
}

class PendingAddress extends GeocodingService {
  final result = Completer<LatLng?>();
  @override
  Future<LatLng?> geocodeAddress(String query) => result.future;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  const patna = LatLng(25.6027, 85.1376),
      muzaffarpur = LatLng(26.1197, 85.3910),
      gaya = LatLng(24.7955, 84.9994),
      delhi = LatLng(28.6139, 77.2090);
  final scenarios = [
    ('Patna → Muzaffarpur', patna, muzaffarpur, gaya),
    ('Muzaffarpur → Patna', muzaffarpur, patna, gaya),
    ('Motihari → Gaya', const LatLng(26.6469, 84.9089), gaya, patna),
    ('Delhi → Patna', delhi, patna, muzaffarpur),
    (
      'Jaipur → Muzaffarpur',
      const LatLng(26.9124, 75.7873),
      muzaffarpur,
      patna,
    ),
  ];
  for (final sector in ['passenger', 'rental', 'logistics', 'premium']) {
    for (final scenario in scenarios) {
      test(
        '$sector: ${scenario.$1} sends selected endpoints, never GPS',
        () async {
          final gps = PendingGps();
          final repository = RecordingRepository()
            ..estimate = FareEstimateModel.fromJson(range(quote: true));
          final socket = ConnectedSocket();
          final container = ProviderContainer(
            overrides: [
              rideRepositoryProvider.overrideWithValue(repository),
              dioProvider.overrideWithValue(mapFixture()),
              locationServiceProvider.overrideWithValue(gps),
              socketServiceProvider.overrideWithValue(socket),
            ],
          );
          addTearDown(() {
            container.dispose();
            socket.dispose();
          });
          final notifier = container.read(rideProvider.notifier);
          notifier.recordCurrentGps(scenario.$2);
          notifier.setRoute(
            'Selected pickup',
            'Selected destination',
            pickupCoords: scenario.$3,
            destCoords: scenario.$4,
            sector: sector,
            vehicleCategory: sector == 'logistics' ? 'mini_truck' : 'sedan',
          );
          await notifier.estimateRouteFare();
          await notifier.requestRide();
          expect(repository.creates, 1);
          expect(repository.bookingPayload!['pickup'], {
            'latitude': scenario.$3.latitude,
            'longitude': scenario.$3.longitude,
          });
          expect(repository.bookingPayload!['destination'], {
            'latitude': scenario.$4.latitude,
            'longitude': scenario.$4.longitude,
          });
          expect(
            repository.bookingPayload!.containsKey('currentGpsCoords'),
            isFalse,
          );
          expect(gps.reads, 0);
        },
      );
    }
  }
  test('late geocoding cannot overwrite a new pickup selection', () async {
    final addresses = PendingAddress();
    final container = ProviderContainer(
      overrides: [geocodingServiceProvider.overrideWithValue(addresses)],
    );
    addTearDown(container.dispose);
    final notifier = container.read(rideProvider.notifier);
    final pending = notifier.geocodeAndSetPickup('Older address');
    notifier.setPickupCoords(muzaffarpur, address: 'Selected pickup');
    addresses.result.complete(patna);
    expect(await pending, isFalse);
    expect(container.read(rideProvider).pickupCoords, muzaffarpur);
  });
  test('late GPS cannot overwrite a selected remote pickup', () async {
    final gps = PendingGps();
    final container = ProviderContainer(
      overrides: [locationServiceProvider.overrideWithValue(gps)],
    );
    addTearDown(container.dispose);
    final notifier = container.read(rideProvider.notifier);
    final pending = notifier.geocodeAndSetPickup('Current Location');
    notifier.setPickupCoords(muzaffarpur, address: 'Selected pickup');
    gps.fix.complete(
      Position(
        latitude: delhi.latitude,
        longitude: delhi.longitude,
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
    expect(await pending, isFalse);
    expect(container.read(rideProvider).pickupCoords, muzaffarpur);
  });
  testWidgets(
    'pickup search does not require GPS and editing clears stale coordinates',
    (tester) async {
      final gps = PendingGps();
      final container = ProviderContainer(
        overrides: [locationServiceProvider.overrideWithValue(gps)],
      );
      container
          .read(rideProvider.notifier)
          .setPickupCoords(patna, address: 'Earlier pickup');
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: PickupSelectionScreen()),
        ),
      );
      await tester.pump();
      expect(gps.reads, 0);
      await tester.enterText(find.byType(TextField).first, 'Muzaffarpur');
      expect(container.read(rideProvider).pickupCoords, isNull);
      expect(container.read(rideProvider).pickup, 'Muzaffarpur');
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      await tester.pump();
    },
  );
}
