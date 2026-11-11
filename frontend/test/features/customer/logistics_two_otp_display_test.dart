import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';
import 'package:infurnus/features/customer/presentation/widgets/assigned_driver_summary.dart';

void main() {
  group('Logistics Two-OTP Customer Display', () {
    testWidgets(
      'shows both Start OTP and Delivery/End OTP for in-progress logistics ride',
      (tester) async {
        final ride = RideModel(
          id: 'logistics-ride-1',
          customerId: 'cust-1',
          sector: 'logistics',
          status: RideStatus.inProgress,
          pin: '1234',
          endPin: '5678',
          pickup: RideLocation(latitude: 12.9, longitude: 77.6),
          destination: RideLocation(latitude: 12.95, longitude: 77.65),
          createdAt: DateTime(2026),
          updatedAt: DateTime(2026),
        );

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Column(
                children: [
                  if (ride.isLogistics) ...[
                    if (ride.pin != null)
                      RidePickupPin(
                        pin: ride.pin!,
                        label: 'Start OTP (share with driver):',
                      ),
                    if (ride.status == RideStatus.inProgress &&
                        ride.endPin != null)
                      RideDeliveryPin(
                        pin: ride.endPin!,
                        label: 'Delivery/End OTP (share at delivery):',
                      ),
                  ],
                ],
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Start OTP (share with driver):'), findsOneWidget);
        expect(find.text('1234'), findsOneWidget);
        expect(
          find.text('Delivery/End OTP (share at delivery):'),
          findsOneWidget,
        );
        expect(find.text('5678'), findsOneWidget);
      },
    );

    testWidgets('shows only Start OTP for logistics ride before trip starts', (
      tester,
    ) async {
      final ride = RideModel(
        id: 'logistics-ride-2',
        customerId: 'cust-1',
        sector: 'logistics',
        status: RideStatus.driverArrived,
        pin: '1234',
        endPin: null, // End OTP is hidden until in_progress
        pickup: RideLocation(latitude: 12.9, longitude: 77.6),
        destination: RideLocation(latitude: 12.95, longitude: 77.65),
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                if (ride.isLogistics) ...[
                  if (ride.pin != null)
                    RidePickupPin(
                      pin: ride.pin!,
                      label: 'Start OTP (share with driver):',
                    ),
                  if (ride.status == RideStatus.inProgress &&
                      ride.endPin != null)
                    RideDeliveryPin(
                      pin: ride.endPin!,
                      label: 'Delivery/End OTP (share at delivery):',
                    ),
                ],
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Start OTP (share with driver):'), findsOneWidget);
      expect(find.text('1234'), findsOneWidget);
      expect(find.textContaining('Delivery/End OTP'), findsNothing);
    });

    testWidgets('shows standard Pickup PIN for non-logistics ride', (
      tester,
    ) async {
      final ride = RideModel(
        id: 'passenger-ride-1',
        customerId: 'cust-1',
        sector: 'passenger',
        status: RideStatus.driverArrived,
        pin: '9876',
        pickup: RideLocation(latitude: 12.9, longitude: 77.6),
        destination: RideLocation(latitude: 12.95, longitude: 77.65),
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                if (ride.isLogistics) ...[
                  if (ride.pin != null)
                    RidePickupPin(
                      pin: ride.pin!,
                      label: 'Start OTP (share with driver):',
                    ),
                ] else if (ride.pin != null && ride.pinVerified != true) ...[
                  RidePickupPin(pin: ride.pin!),
                ],
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Pickup PIN (share with driver):'), findsOneWidget);
      expect(find.text('9876'), findsOneWidget);
      expect(find.textContaining('Start OTP'), findsNothing);
      expect(find.textContaining('Delivery/End OTP'), findsNothing);
    });
  });
}
