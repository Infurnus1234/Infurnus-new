import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/presentation/screens/notification_preferences_screen.dart';

void main() {
  testWidgets(
    'NotificationPreferencesScreen renders header, status card and alert categories',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: NotificationPreferencesScreen()),
      );

      // Initial pump
      await tester.pump();

      // Verify Title and Sections
      expect(find.text('Notification Preferences'), findsOneWidget);
      expect(find.text('Alert Categories'), findsOneWidget);
      expect(find.text('Trip & Ride Status'), findsOneWidget);
      expect(find.text('Safety & Security Alerts'), findsOneWidget);
      expect(find.text('Offers & Promotions'), findsOneWidget);

      // Verify switches can be toggled
      final switches = find.byType(Switch);
      expect(switches, findsNWidgets(3));

      // Toggle the offers switch
      await tester.tap(switches.last);
      await tester.pump();
    },
  );
}
