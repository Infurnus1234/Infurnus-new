import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/presentation/screens/profile_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'Privacy Settings opens app settings and reports unavailable settings',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var calls = 0;
      const channel = MethodChannel('flutter.baseflow.com/permissions/methods');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'openAppSettings') {
              calls++;
              return false;
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null),
      );
      await tester.pumpWidget(
        const ProviderScope(child: MaterialApp(home: ProfileScreen())),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Privacy Settings'));
      await tester.tap(find.text('Privacy Settings'));
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(
        find.text('Open your device settings to manage INFURNUS permissions.'),
        findsOneWidget,
      );
    },
  );
}
