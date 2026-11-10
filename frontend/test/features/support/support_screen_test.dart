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

  testWidgets(
    'UA-01: Merged email support into single card, keeping In-App Chat separate',
    (tester) async {
      await tester.pumpWidget(const MaterialApp(home: SupportScreen()));
      await tester.pumpAndSettle();

      // Scroll to reveal bottom contact options if needed
      await tester.drag(find.byType(ListView), const Offset(0, -400));
      await tester.pumpAndSettle();

      // Exactly one Email Support action
      expect(find.text('Email Support'), findsOneWidget);
      expect(find.text('Send Email'), findsNothing);

      // In-App Chat is present as separate channel
      expect(find.text('In-App Chat'), findsOneWidget);
    },
  );
}
