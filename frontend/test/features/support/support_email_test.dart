import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/config/legal_texts.dart';
import 'package:infurnus/features/support/presentation/screens/support_screen.dart';

void main() {
  group('Help Center & Support Email Tests', () {
    testWidgets(
      'SupportScreen displays official support email support@infurnuslogistics.com',
      (WidgetTester tester) async {
        await tester.pumpWidget(const MaterialApp(home: SupportScreen()));
        await tester.pump();

        // Verify email string is explicitly displayed
        expect(find.text('support@infurnuslogistics.com'), findsAtLeast(1));

        // Verify Email Support options exist
        expect(find.text('Email Support'), findsOneWidget);
        expect(find.text('INFURNUS Help Center'), findsOneWidget);
      },
    );

    test('Legal texts use support@infurnuslogistics.com consistently', () {
      expect(
        LegalTexts.privacyPolicy.contains('support@infurnuslogistics.com'),
        isTrue,
      );
      expect(
        LegalTexts.termsOfService.contains('support@infurnuslogistics.com'),
        isTrue,
      );
      expect(
        LegalTexts.contentPolicy.contains('support@infurnuslogistics.com'),
        isTrue,
      );
      expect(
        LegalTexts.privacyPolicy.contains('support@infurnus.com'),
        isFalse,
      );
    });
  });
}
