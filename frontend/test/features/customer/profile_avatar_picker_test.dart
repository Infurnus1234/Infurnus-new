import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/presentation/screens/profile_screen.dart';

void main() {
  testWidgets(
    'ProfileScreen avatar shows camera icon and opens photo picker sheet on tap',
    (tester) async {
      await tester.pumpWidget(
        const ProviderScope(child: MaterialApp(home: ProfileScreen())),
      );

      await tester.pumpAndSettle();

      // Verify camera icon exists
      final cameraIcon = find.byIcon(Icons.camera_alt_rounded);
      expect(cameraIcon, findsOneWidget);

      // Tap on the camera icon / avatar
      await tester.tap(cameraIcon);
      await tester.pumpAndSettle();

      // Verify bottom sheet appears with Camera and Gallery options
      expect(find.text('Change Profile Photo'), findsOneWidget);
      expect(find.text('Take Photo'), findsOneWidget);
      expect(find.text('Choose from Gallery'), findsOneWidget);
    },
  );
}
