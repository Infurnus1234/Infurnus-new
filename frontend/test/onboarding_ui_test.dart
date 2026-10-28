import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:infurnus/features/driver/presentation/screens/driver_onboarding_screen.dart';

void main() {
  testWidgets('DriverOnboardingScreen works at 320px width with large text scale', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      const MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(2.0)),
        child: ProviderScope(
          child: MaterialApp(
            home: DriverOnboardingScreen(),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(DriverOnboardingScreen), findsOneWidget);
  });
}
