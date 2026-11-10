import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _buildCallButton({required bool hasDriverPhone, VoidCallback? onTap}) {
  return MaterialApp(
    home: Scaffold(
      body: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.phone_rounded),
            tooltip: hasDriverPhone ? 'Call driver' : 'A provider must be assigned to an active booking before you can call.',
            onPressed: hasDriverPhone ? onTap : null,
          ),
          if (!hasDriverPhone)
            const Text(
              'Call unavailable\nuntil assigned',
              textAlign: TextAlign.center,
            ),
        ],
      ),
    ),
  );
}

void main() {
  testWidgets(
    'Call button is disabled and shows prerequisite when no driver is assigned',
    (tester) async {
      await tester.pumpWidget(_buildCallButton(hasDriverPhone: false));

      expect(find.text('Call unavailable\nuntil assigned'), findsOneWidget);
      final button = tester.widget<IconButton>(find.byType(IconButton));
      expect(button.onPressed, isNull);
      expect(
        button.tooltip,
        'A provider must be assigned to an active booking before you can call.',
      );
    },
  );

  testWidgets(
    'Call button is enabled and has Call driver tooltip when driver has phone',
    (tester) async {
      var tapped = false;
      await tester.pumpWidget(
        _buildCallButton(hasDriverPhone: true, onTap: () => tapped = true),
      );

      expect(find.text('Call unavailable\nuntil assigned'), findsNothing);
      final button = tester.widget<IconButton>(find.byType(IconButton));
      expect(button.onPressed, isNotNull);
      expect(button.tooltip, 'Call driver');

      await tester.tap(find.byType(IconButton));
      expect(tapped, isTrue);
    },
  );
}
