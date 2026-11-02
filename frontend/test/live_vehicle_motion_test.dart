import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import 'package:infurnus/shared/widgets/vehicle_motion.dart';

void main() {
  testWidgets(
    'Patna fixes interpolate and rotate by the shortest heading arc',
    (tester) async {
      final motion = VehicleMotion(tester);
      final time = DateTime.utc(2026, 10, 28);
      expect(
        motion.sample(
          const LatLng(25.5941, 85.1376),
          time,
          heading: 350,
          speed: 8,
          accuracy: 5,
        ),
        isTrue,
      );
      motion.animation.value = 1;
      expect(
        motion.sample(
          const LatLng(25.59415, 85.13765),
          time.add(const Duration(seconds: 1)),
          heading: 10,
          speed: 8,
          accuracy: 5,
        ),
        isTrue,
      );
      motion.animation.value = 0.5;
      expect(motion.position!.latitude, closeTo(25.594125, 0.000001));
      expect(motion.heading, closeTo(0, 0.01));
      motion.animation.value = 1;
      expect(motion.heading, closeTo(10, 0.01));
      motion.sample(
        const LatLng(25.59415, 85.13765),
        time.add(const Duration(seconds: 2)),
        heading: 190,
        speed: 0,
        accuracy: 5,
      );
      motion.animation.value = 1;
      expect(motion.heading, closeTo(10, 0.01));
      expect(motion.sample(const LatLng(25.5941, 85.1376), time), isFalse);
      expect(
        motion.sample(
          const LatLng(26, 86),
          time.add(const Duration(seconds: 3)),
        ),
        isFalse,
      );
      expect(
        motion.sample(
          const LatLng(25.5942, 85.1377),
          time.add(const Duration(seconds: 3)),
          accuracy: 500,
        ),
        isFalse,
      );
      motion.dispose();
    },
  );
  test(
    'route deviation measures road segments rather than sparse vertices',
    () {
      expect(
        VehicleMotion.deviation(const LatLng(25.5941, 85.14), [
          const LatLng(25.5941, 85.13),
          const LatLng(25.5941, 85.15),
        ]),
        lessThan(0.1),
      );
    },
  );
}
