import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:infurnus/app/app.dart';
import 'package:infurnus/features/customer/presentation/screens/customer_home_screen.dart';
import 'package:infurnus/features/splash/presentation/screens/splash_screen.dart';

void main() {
  testWidgets('Infurnus app loads successfully', (WidgetTester tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    await tester.pumpWidget(const ProviderScope(child: InfurnusApp()));

    expect(find.byType(InfurnusApp), findsOneWidget);

    // The startup screen deliberately plays animations.
    // Advance startup frames without waiting for that animation to stop.
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(
      find.byWidgetPredicate(
        (w) => w is CustomerHomeScreen || w is SplashScreen,
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
