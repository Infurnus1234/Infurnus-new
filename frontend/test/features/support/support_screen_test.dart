import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/support/presentation/screens/support_screen.dart';

void main() {
  testWidgets(
    'SupportScreen displays official support email support@infurnuslogistics.com',
    (tester) async {
      await tester.pumpWidget(const MaterialApp(home: SupportScreen()));

      await tester.pumpAndSettle();

      // Verify official support email is displayed
      expect(
        find.textContaining('support@infurnuslogistics.com'),
        findsAtLeastNWidgets(1),
      );
      expect(find.text('Email Support'), findsOneWidget);
      expect(find.text('Help & Support'), findsOneWidget);
    },
  );
}
