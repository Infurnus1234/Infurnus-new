import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';

import 'package:infurnus/shared/widgets/map_camera_queue.dart';

import 'recording_maps.dart';

void main() {
  testWidgets(
    'GPS bursts coalesce; pan and disposal cancel pending camera work',
    (tester) async {
      final previous = GoogleMapsFlutterPlatform.instance;
      final maps = RecordingMaps();
      GoogleMapsFlutterPlatform.instance = maps;
      addTearDown(() => GoogleMapsFlutterPlatform.instance = previous);
      final camera = MapCameraQueue();
      await tester.pumpWidget(
        MaterialApp(
          home: GoogleMap(
            initialCameraPosition: const CameraPosition(target: LatLng(25, 85)),
            onMapCreated: (controller) => camera.controller = controller,
          ),
        ),
      );
      await tester.pump();
      for (var i = 0; i < 100; i++) {
        camera.move(CameraUpdate.newLatLng(LatLng(25 + i / 10000, 85)));
      }
      await tester.pump();
      expect(maps.cameraCalls, 1);
      await tester.pump(const Duration(seconds: 1));
      expect(maps.cameraCalls, 2);
      expect(maps.created.length, 1);
      camera.move(CameraUpdate.newLatLng(const LatLng(26, 85)));
      camera.cancel();
      await tester.pump(const Duration(seconds: 1));
      expect(maps.cameraCalls, 2);
      camera.move(CameraUpdate.newLatLng(const LatLng(27, 85)));
      camera.move(CameraUpdate.newLatLng(const LatLng(28, 85)));
      await tester.pump();
      expect(maps.cameraCalls, 3);
      camera.dispose();
      await tester.pump(const Duration(seconds: 2));
      expect(maps.cameraCalls, 3);
      await tester.pumpWidget(const SizedBox());
      expect(tester.takeException(), isNull);
    },
  );
}
