import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:infurnus/features/onboarding/presentation/screens/onboarding_screen.dart';
import 'package:infurnus/shared/widgets/infurnus_empty_state.dart';
import 'package:infurnus/shared/widgets/infurnus_brand_mark.dart';

void main() {
  group('OnboardingScreen Widget Tests', () {
    testWidgets('renders first screen and navigates across all 3 pages',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: OnboardingScreen(),
          ),
        ),
      );

      // Verify Screen 1 title and description
      expect(find.text('Your ride, your way'), findsOneWidget);
      expect(
          find.text('Book a Bike, Auto, Sedan or SUV whenever you need it.'),
          findsOneWidget);
      expect(find.text('Skip'), findsOneWidget);
      expect(find.text('Next'), findsOneWidget);

      // Tap Next to navigate to Screen 2
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      // Verify Screen 2 title and description
      expect(find.text('Move anything with ease'), findsOneWidget);
      expect(
          find.text(
              'Send your goods safely with the right vehicle for your delivery.'),
          findsOneWidget);

      // Tap Next to navigate to Screen 3
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      // Verify Screen 3 title, description, and "Get Started" button
      expect(find.text('More than just a ride'), findsOneWidget);
      expect(
          find.text(
              'Premium vehicles, towing, ambulance, JCB and roadside services — all in one place.'),
          findsOneWidget);
      expect(find.text('Get Started'), findsOneWidget);
    });
  });

  group('Shared Widgets Tests', () {
    testWidgets('InfurnusEmptyState renders title, description, and action button',
        (WidgetTester tester) async {
      bool actionTapped = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: InfurnusEmptyState(
              icon: Icons.receipt_long_rounded,
              title: 'No bookings yet',
              description: 'Your completed rides will appear here.',
              actionLabel: 'Book a Ride',
              onAction: () => actionTapped = true,
            ),
          ),
        ),
      );

      expect(find.text('No bookings yet'), findsOneWidget);
      expect(find.text('Your completed rides will appear here.'), findsOneWidget);
      expect(find.text('Book a Ride'), findsOneWidget);

      await tester.tap(find.text('Book a Ride'));
      expect(actionTapped, isTrue);
    });

    testWidgets('InfurnusBrandMark renders icon and typography',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: InfurnusBrandMark(
              iconSize: 32,
              fontSize: 18,
            ),
          ),
        ),
      );

      expect(find.text('N'), findsOneWidget);
      expect(find.text('INFURNUS'), findsOneWidget);
    });
  });
}
