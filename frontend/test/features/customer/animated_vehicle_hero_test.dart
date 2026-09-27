import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/presentation/widgets/animated_vehicle_hero.dart';

void main() {
  testWidgets('AnimatedVehicleHero renders without errors and shows placeholder slot', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: AnimatedVehicleHero(height: 100),
        ),
      ),
    );

    // Initial render
    expect(find.byType(AnimatedVehicleHero), findsOneWidget);
    expect(find.text('INFURNUS FLEET'), findsOneWidget);
    expect(find.text('Active & Ready'), findsOneWidget);

    // Animate forward to ensure animation transitions smoothly without overflow
    await tester.pump(const Duration(milliseconds: 1200));
    expect(find.byType(AnimatedVehicleHero), findsOneWidget);
  });
}
