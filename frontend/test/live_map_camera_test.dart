import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/shared/widgets/infurnus_map.dart';

import 'recording_maps.dart';

class NoGps extends LocationService {
  @override
  Future<Position?> getCurrentPosition() async => null;
}

void main() {
  testWidgets(
    'map marker animates; follow pauses on pan, resumes on recenter, and reports stale GPS',
    (tester) async {
      final previous = GoogleMapsFlutterPlatform.instance;
      final maps = RecordingMaps();
      GoogleMapsFlutterPlatform.instance = maps;
      addTearDown(() => GoogleMapsFlutterPlatform.instance = previous);
      final start = DateTime.now().subtract(const Duration(seconds: 25));
      final fixes = ValueNotifier(
        DriverLocation(
          latitude: 25.5941,
          longitude: 85.1376,
          timestamp: start,
          heading: 0,
          speed: 5,
          accuracy: 5,
        ),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [locationServiceProvider.overrideWithValue(NoGps())],
          child: MaterialApp(
            home: Scaffold(
              body: ValueListenableBuilder(
                valueListenable: fixes,
                builder: (_, fix, _) => InfurnusMap(driverLocation: fix),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      final before = maps.cameraCalls;
      fixes.value = DriverLocation(
        latitude: 25.59415,
        longitude: 85.13765,
        timestamp: start.add(const Duration(seconds: 1)),
        heading: 90,
        speed: 5,
        accuracy: 5,
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      final map = tester.widget<GoogleMap>(find.byType(GoogleMap));
      final driver = map.markers.singleWhere(
        (m) => m.markerId.value == 'driver',
      );
      expect(driver.position.latitude, greaterThan(25.5941));
      expect(driver.position.latitude, lessThan(25.59415));
      expect(driver.rotation, greaterThan(0));
      expect(driver.rotation, lessThan(90));
      expect(driver.flat, isTrue);
      expect(maps.cameraCalls, greaterThan(before));
      await tester.tap(find.byKey(const Key('recording-map')));
      final afterPan = maps.cameraCalls;
      fixes.value = DriverLocation(
        latitude: 25.5942,
        longitude: 85.1377,
        timestamp: start.add(const Duration(seconds: 2)),
        heading: 90,
        speed: 5,
      );
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(maps.cameraCalls, afterPan);
      await tester.tap(find.byTooltip('Follow driver / fit route'));
      await tester.pump();
      expect(maps.cameraCalls, greaterThan(afterPan));
      await tester.pump(const Duration(seconds: 2));
      expect(find.textContaining('Driver location is stale'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      fixes.dispose();
      expect(tester.takeException(), isNull);
    },
  );
}
