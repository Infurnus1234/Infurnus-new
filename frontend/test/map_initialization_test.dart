import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/shared/widgets/infurnus_map.dart';

import 'recording_maps.dart';

class ImmediateGps extends LocationService {
  @override
  Future<Position?> getCurrentPosition() async => Position(
    latitude: 25.5941,
    longitude: 85.1376,
    timestamp: DateTime.now(),
    accuracy: 5,
    altitude: 0,
    altitudeAccuracy: 0,
    heading: 0,
    headingAccuracy: 0,
    speed: 0,
    speedAccuracy: 0,
  );
  @override
  Stream<Position> getPositionStream() => const Stream.empty();
}

void main() {
  testWidgets(
    'GPS arriving before the native map is ready still centers the camera',
    (tester) async {
      final previous = GoogleMapsFlutterPlatform.instance;
      final maps = RecordingMaps(deferCreation: true);
      GoogleMapsFlutterPlatform.instance = maps;
      addTearDown(() => GoogleMapsFlutterPlatform.instance = previous);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            locationServiceProvider.overrideWithValue(ImmediateGps()),
          ],
          child: const MaterialApp(home: Scaffold(body: InfurnusMap())),
        ),
      );
      await tester.pump();
      expect(
        tester.widget<GoogleMap>(find.byType(GoogleMap)).myLocationEnabled,
        isTrue,
      );
      expect(tester.widget<GoogleMap>(find.byType(GoogleMap)).markers, isEmpty);
      maps.completeCreation();
      await tester.pump();
      await tester.pump();
      expect(
        maps.cameraCalls,
        greaterThan(0),
        reason: 'The current GPS fix must be replayed when native map creation finishes.',
      );
      await tester.pumpWidget(const SizedBox());
    },
  );
}
