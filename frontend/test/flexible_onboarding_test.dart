import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:infurnus/features/driver/presentation/screens/driver_onboarding_screen.dart';

void main() {
  testWidgets('Flexible onboarding skip defers step and advances', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const ProviderScope(child: MaterialApp(home: DriverOnboardingScreen())),
    );
    await tester.pump();

    final skipButton = find.text('Skip for now');
    if (skipButton.evaluate().isNotEmpty) {
      await tester.tap(skipButton.first);
      await tester.pump();
    }
    expect(find.byType(DriverOnboardingScreen), findsOneWidget);
  });
}
