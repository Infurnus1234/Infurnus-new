import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/route_model.dart';
import 'package:infurnus/shared/widgets/route_distance_summary.dart';

void main() {
  testWidgets('shows road distance and duration without fare or vehicle data', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: RouteDistanceSummary(
            route: RouteModel(distanceMeters: 12670, durationSeconds: 901),
          ),
        ),
      ),
    );
    expect(find.text('Road distance: 12.7 km'), findsOneWidget);
    expect(find.text('~16 mins'), findsOneWidget);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: RouteDistanceSummary(
            route: RouteModel(distanceMeters: 62052, durationSeconds: 3600),
          ),
        ),
      ),
    );
    expect(find.text('Road distance: 62.1 km'), findsOneWidget);
    expect(find.text('Road distance: 12.7 km'), findsNothing);
  });
}
