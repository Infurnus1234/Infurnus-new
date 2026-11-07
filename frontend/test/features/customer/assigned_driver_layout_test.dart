import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';
import 'package:infurnus/features/customer/presentation/widgets/assigned_driver_summary.dart';

void main() {
  testWidgets('broken remote profile image uses a stable circular fallback', (
    tester,
  ) async {
    final ride = RideModel(
      id: 'ride',
      customerId: 'customer',
      pickup: RideLocation(latitude: 25, longitude: 85),
      destination: RideLocation(latitude: 26, longitude: 85),
      status: RideStatus.driverAssigned,
      driverDetails: DriverDetails(
        id: 'driver',
        name: 'Audit Driver',
        photoUrl: 'https://example.invalid/broken-profile.png',
      ),
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AssignedDriverSummary(ride: ride, onCall: () {}),
        ),
      ),
    );
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(tester.getSize(find.byType(ClipOval)), const Size(52, 52));
    expect(find.byIcon(Icons.person_rounded), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  const name = 'A very long driver name Niranjan Bhardwaj Kumar Singh';
  final vehicleName = List.filled(8, 'Long vehicle model').join(' ');
  for (final width in [240.0, 280.0, 320.0, 360.0, 430.0, 600.0]) {
    for (final scale in [1.0, 1.3, 2.0]) {
      testWidgets(
        'matched heading/card/PIN width $width text $scale preserves content and call target',
        (tester) async {
          tester.view.physicalSize = Size(width, 844);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          var calls = 0;
          final ride = RideModel(
            id: 'ride',
            customerId: 'customer',
            bookingId: '4400382',
            pickup: RideLocation(latitude: 25, longitude: 85),
            destination: RideLocation(latitude: 26, longitude: 85),
            status: RideStatus.driverAssigned,
            driverDetails: DriverDetails(
              id: 'driver',
              name: name,
              rating: 4.8,
              photoUrl: 'not a valid URL',
            ),
            vehicleDetails: VehicleDetails(
              make: 'Tata',
              model: vehicleName,
              plateNumber: 'BR-01-TEST',
            ),
            createdAt: DateTime(2026),
            updatedAt: DateTime(2026),
          );
          await tester.pumpWidget(
            MaterialApp(
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(scale)),
                child: child!,
              ),
              home: Scaffold(
                body: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const DriverMatchedHeader(
                        title: 'Driver Assigned & Heading to You',
                      ),
                      const SizedBox(height: 16),
                      AssignedDriverSummary(ride: ride, onCall: () => calls++),
                      const RidePickupPin(pin: '0038'),
                    ],
                  ),
                ),
              ),
            ),
          );
          await tester.pump();
          expect(tester.takeException(), isNull);
          expect(find.text(name), findsOneWidget);
          expect(find.text('Booking ID: 4400382'), findsOneWidget);
          expect(find.text('0038'), findsOneWidget);
          expect(tester.getSize(find.byType(ClipOval)), const Size(52, 52));
          final button = find.byTooltip('Call driver');
          await tester.ensureVisible(button);
          await tester.tap(button);
          await tester.pump();
          expect(calls, 1);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        },
      );
    }
  }
}
