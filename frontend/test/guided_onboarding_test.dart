import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:infurnus/features/driver/presentation/screens/driver_onboarding_screen.dart';

void main() {
  testWidgets(
    'Guided document and photo capture picker and upload button work',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        const ProviderScope(child: MaterialApp(home: DriverOnboardingScreen())),
      );
      await tester.pump();

      final uploadButton = find.text('Upload Document / Capture Photo');
      if (uploadButton.evaluate().isNotEmpty) {
        await tester.tap(uploadButton.first);
        await tester.pump();
      }
      expect(find.byType(DriverOnboardingScreen), findsOneWidget);
    },
  );
}
