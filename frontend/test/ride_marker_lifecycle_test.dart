import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/shared/widgets/infurnus_map.dart';
import 'package:infurnus/shared/widgets/vehicle_motion.dart';

import 'live_map_camera_test.dart' show NoGps;
import 'recording_maps.dart';

void main() {
  testWidgets(
    'ride state changes colors and pickup visibility without recreating map or duplicating vehicle',
    (tester) async {
      await tester.runAsync(navigationArrow);
      final previous = GoogleMapsFlutterPlatform.instance;
      final maps = RecordingMaps();
      GoogleMapsFlutterPlatform.instance = maps;
      addTearDown(() => GoogleMapsFlutterPlatform.instance = previous);
      final fix = DriverLocation(
        latitude: 25.59,
        longitude: 85.13,
        timestamp: DateTime.now(),
        heading: 90,
        speed: 5,
        accuracy: 5,
      );
      for (final status in [
        'requested',
        'driver_assigned',
        'driver_arrived',
        'inProgress',
      ]) {
        await tester.pumpWidget(
          ProviderScope(
            overrides: [locationServiceProvider.overrideWithValue(NoGps())],
            child: MaterialApp(
              home: Scaffold(
                body: InfurnusMap(
                  rideStatus: status,
                  pickup: const LatLng(25.59, 85.13),
                  destination: const LatLng(25.61, 85.14),
                  driverLocation: fix,
                ),
              ),
            ),
          ),
        );
        await tester.pump();
        final map = tester.widget<GoogleMap>(find.byType(GoogleMap));
        expect(
          map.markers.where((m) => m.markerId.value == 'driver').length,
          1,
        );
        expect(map.markers.any((m) => m.markerId.value == 'current'), isFalse);
        expect(map.myLocationEnabled, isFalse);
        final pickup = map.markers.where((m) => m.markerId.value == 'pickup');
        expect(pickup.isEmpty, status == 'inProgress');
        if (pickup.isNotEmpty) {
          expect(
            pickup.single.icon.toJson(),
            BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed)
                .toJson(),
          );
        }
        final drop = map.markers.singleWhere(
          (m) => m.markerId.value == 'destination',
        );
        expect(
          drop.icon.toJson(),
          BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen)
              .toJson(),
        );
        final arrow = map.markers.singleWhere(
          (m) => m.markerId.value == 'driver',
        );
        expect(arrow.flat, isTrue);
        expect(arrow.anchor, const Offset(.5, .5));
        expect(maps.created.length, 1);
      }
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(maps.created.length, 1);
      expect(
        tester
            .widget<GoogleMap>(find.byType(GoogleMap))
            .markers
            .any((m) => m.markerId.value == 'pickup'),
        isFalse,
      );
      await tester.pumpWidget(const SizedBox());
    },
  );
}
