import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/core/config/legal_texts.dart';
import 'package:infurnus/features/customer/presentation/screens/legal_document_screen.dart';

void main() {
  testWidgets('Privacy Policy preserves heading hierarchy and list styling', (
    tester,
  ) async {
    const headings = [
      '1. Introduction',
      '2. Data We Collect',
      '2.1 Information You Provide:',
      '2.2 Information Collected Automatically:',
      '3. Purpose of Collection',
      '4. Legal Basis for Processing (DPDP Act, 2023)',
      '5. Data Sharing and Disclosure',
      '6. Grievance Officer',
    ];
    for (final width in [360.0, 800.0]) {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(width, 780);
      await tester.pumpWidget(
        const MaterialApp(
          home: LegalDocumentScreen(
            title: 'Privacy Policy',
            content: LegalTexts.privacyPolicy,
          ),
        ),
      );

      final text = tester.widgetList<Text>(find.byType(Text)).toList();
      expect(
        text
            .where((w) => RegExp(r'^\d+\.').hasMatch(w.data ?? ''))
            .map((w) => w.data),
        headings,
      );
      Text label(String value) => tester.widget<Text>(find.text(value));
      final mainStyle = label(headings.first).style!;
      for (final heading in headings.where(
        (h) => !h.startsWith('2.1') && !h.startsWith('2.2'),
      )) {
        expect(label(heading).style, mainStyle);
      }
      final subsectionStyle = label(headings[2]).style!;
      expect(subsectionStyle.fontWeight, FontWeight.bold);
      expect(label(headings[3]).style, subsectionStyle);

      final body = label('We use your data to:').style!;
      final bullet = label(
        'Create and manage user and vehicle-partner accounts',
      ).style!;
      expect(bullet.fontSize, body.fontSize);
      expect(bullet.fontWeight, body.fontWeight);
      expect(bullet.height, body.height);
      expect(bullet.fontFamily, body.fontFamily);
      expect(
        find.byIcon(Icons.check_circle_outline_rounded),
        findsNWidgets(24),
      );
      expect(find.byTooltip('Share'), findsOneWidget);
      expect(find.text('I Understand & Accept'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}
