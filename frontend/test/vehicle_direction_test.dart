import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/shared/widgets/vehicle_motion.dart';

void main() {
  final directions = <String, (LatLng, double)>{
    'north': (const LatLng(.0004, 0), 0),
    'northeast': (const LatLng(.0004, .0004), 45),
    'east': (const LatLng(0, .0004), 90),
    'southeast': (const LatLng(-.0004, .0004), 135),
    'south': (const LatLng(-.0004, 0), 180),
    'southwest': (const LatLng(-.0004, -.0004), 225),
    'west': (const LatLng(0, -.0004), 270),
    'northwest': (const LatLng(.0004, -.0004), 315),
  };
  for (final entry in directions.entries) {
    testWidgets('movement ${entry.key} overrides a backwards reported course', (
      tester,
    ) async {
      final motion = VehicleMotion(tester);
      final time = DateTime.utc(2026, 11, 4);
      final wrong = (entry.value.$2 + 180) % 360;
      motion.sample(
        const LatLng(0, 0),
        time,
        heading: wrong,
        speed: 10,
        accuracy: 2,
      );
      motion.animation.value = 1;
      motion.sample(
        entry.value.$1,
        time.add(const Duration(seconds: 1)),
        heading: wrong,
        speed: 10,
        accuracy: 2,
      );
      motion.animation.value = 1;
      expect(motion.heading, closeTo(entry.value.$2, .01));
      motion.sample(
        entry.value.$1,
        time.add(const Duration(seconds: 2)),
        heading: wrong,
        speed: 0,
        accuracy: 2,
      );
      motion.animation.value = 1;
      expect(motion.heading, closeTo(entry.value.$2, .01));
      motion.dispose();
    });
  }
  test('dateline course remains eastbound', () {
    expect(
      VehicleMotion.bearing(
        const LatLng(0, 179.999),
        const LatLng(0, -179.999),
      ),
      closeTo(90, .01),
    );
  });
  testWidgets('unconfirmed 180 degree GPS reversal is ignored', (tester) async {
    final motion = VehicleMotion(tester);
    final time = DateTime.utc(2026, 11, 4);
    motion.sample(const LatLng(0, 0), time, heading: 90, speed: 5, accuracy: 5);
    motion.animation.value = 1;
    motion.sample(
      const LatLng(0, .00001),
      time.add(const Duration(seconds: 1)),
      heading: 270,
      speed: 5,
      accuracy: 5,
    );
    motion.animation.value = 1;
    expect(motion.heading, 90);
    motion.dispose();
  });
  testWidgets(
    'short samples accumulate enough travel to correct a reversed course',
    (tester) async {
      final motion = VehicleMotion(tester);
      final time = DateTime.utc(2026, 11, 4);
      motion.sample(
        const LatLng(0, 0),
        time,
        heading: 270,
        speed: 3,
        accuracy: 1,
      );
      motion.animation.value = 1;
      for (var i = 1; i <= 4; i++) {
        motion.sample(
          LatLng(0, i * .00003),
          time.add(Duration(seconds: i)),
          heading: 270,
          speed: 3,
          accuracy: 1,
        );
        motion.animation.value = 1;
      }
      expect(motion.heading, closeTo(90, .01));
      motion.dispose();
    },
  );
}
