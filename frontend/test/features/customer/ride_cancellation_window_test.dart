import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';
import 'package:infurnus/features/customer/presentation/widgets/ride_cancellation_button.dart';
import 'package:infurnus/features/customer/presentation/widgets/vehicle_presentation_catalog.dart';

void main() {
  test(
    'Service Vehicle catalog keeps meaningful card copy across refreshes',
    () {
      const descriptions = {
        'ambulance': 'Patient + Medical Triage',
        'jcb': 'Excavation Assistance',
        'towing': 'Breakdown Assistance',
        'crane': 'Heavy lifting assistance',
      };
      for (var refresh = 0; refresh < 2; refresh++) {
        final cards = customerVehiclePresentation('service', [
          for (final entry in descriptions.entries)
            FleetVehicleModel.fromJson({
              'id': '${entry.key}-$refresh',
              'sector': 'service',
              'category': entry.key,
              'name': entry.key,
              'subtitle': '${entry.value} • Trip-Based',
            }),
        ]);
        expect(cards.length, descriptions.length);
        for (final card in cards) {
          expect(card['subtitle'], descriptions[card['category']]);
          expect(card['capacity'], card['subtitle']);
          expect(card['image'], isNotEmpty);
        }
      }
    },
  );

  testWidgets('counts down from 05:00 and disables cancellation at expiry', (
    tester,
  ) async {
    var seconds = 300;
    var cancellations = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: RideCancellationButton(
            remainingSeconds: () => seconds,
            onPressed: () => cancellations++,
          ),
        ),
      ),
    );
    expect(find.text('05:00 left'), findsOneWidget);
    seconds = 299;
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('04:59 left'), findsOneWidget);
    await tester.tap(find.text('Cancel Ride'));
    expect(cancellations, 1);

    seconds = 1;
    await tester.pump(const Duration(seconds: 298));
    expect(find.text('00:01 left'), findsOneWidget);
    seconds = 0;
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Cancellation unavailable'), findsOneWidget);
    expect(
      tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
      isNull,
    );
  });

  for (final sector in ['logistics', 'rental', 'premium', 'service']) {
    test(
      '$sector reconstructs the countdown from server time and deadline',
      () {
        RideModel response(String time) => RideModel.fromJson({
          'id': 'ride-$sector',
          'customerId': 'customer',
          'sector': sector,
          'status': 'driver_arriving',
          'pickup': {'latitude': 25.6, 'longitude': 85.1},
          'destination': {'latitude': 25.7, 'longitude': 85.1},
          'createdAt': '2026-11-10T09:58:00.000Z',
          'updatedAt': '2026-11-10T10:00:00.000Z',
          'customerCancellationDeadline': '2026-11-10T10:05:00.000Z',
          'cancellationServerTime': time,
        });

        final initial = response('2026-11-10T10:00:00.000Z');
        final resumed = response('2026-11-10T10:02:24.000Z');
        final expired = response('2026-11-10T10:05:00.000Z');
        expect(initial.cancellationWindow?.remainingSeconds, 300);
        expect(resumed.cancellationWindow?.remainingSeconds, 156);
        expect(expired.cancellationWindow?.remainingSeconds, 0);
        expect(
          initial.preserveEarlierCancellationExpiry(resumed).cancellationWindow,
          same(resumed.cancellationWindow),
        );
        expect(
          resumed
              .preserveEarlierCancellationExpiry(expired)
              .cancellationWindow
              ?.remainingSeconds,
          0,
        );
      },
    );
  }
}
