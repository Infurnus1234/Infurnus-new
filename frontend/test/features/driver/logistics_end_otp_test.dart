import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart';
import 'package:infurnus/features/driver/data/models/partner_model.dart';
import 'package:infurnus/features/driver/presentation/providers/driver_dashboard_provider.dart';
import 'package:infurnus/features/driver/presentation/providers/driver_ride_provider.dart';
import 'package:infurnus/features/driver/presentation/screens/driver_ride_request_screen.dart';

class MockDriverDashboardNotifier extends StateNotifier<DriverDashboardState>
    implements DriverDashboardNotifier {
  MockDriverDashboardNotifier(super.state);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class MockDriverRideNotifier extends StateNotifier<DriverRideState>
    implements DriverRideNotifier {
  MockDriverRideNotifier(super.state);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('Driver End-OTP UI', () {
    testWidgets(
      'shows Delivery PIN input and verify button for in-progress logistics ride',
      (tester) async {
        final logisticsRide = RideModel(
          id: 'logistics-ride-1',
          customerId: 'customer-1',
          sector: 'logistics',
          status: RideStatus.inProgress,
          pickup: RideLocation(latitude: 12.9, longitude: 77.6),
          destination: RideLocation(latitude: 12.95, longitude: 77.65),
          createdAt: DateTime(2026),
          updatedAt: DateTime(2026),
        );

        final partner = PartnerModel(
          id: 'p-1',
          userId: 'u-1',
          businessName: 'Test Partner',
          approvalStatus: 'approved',
          availabilityStatus: 'available',
          createdAt: DateTime(2026),
          updatedAt: DateTime(2026),
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              driverDashboardProvider.overrideWith(
                (ref) => MockDriverDashboardNotifier(
                  DriverDashboardState(partner: partner, isLoading: false),
                ),
              ),
              driverRideProvider.overrideWith(
                (ref) => MockDriverRideNotifier(
                  DriverRideState(
                    currentRide: logisticsRide,
                    availableRides: [],
                  ),
                ),
              ),
            ],
            child: const MaterialApp(home: DriverRideRequestScreen()),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Delivery PIN'), findsOneWidget);
        expect(find.text('Verify Delivery PIN & Complete'), findsOneWidget);
        expect(
          find.text(
            'Ask the customer for their 4-digit Delivery PIN to complete the trip.',
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'shows standard Complete Ride button without PIN input for non-logistics ride',
      (tester) async {
        final passengerRide = RideModel(
          id: 'passenger-ride-1',
          customerId: 'customer-1',
          sector: 'passenger',
          status: RideStatus.inProgress,
          pickup: RideLocation(latitude: 12.9, longitude: 77.6),
          destination: RideLocation(latitude: 12.95, longitude: 77.65),
          createdAt: DateTime(2026),
          updatedAt: DateTime(2026),
        );

        final partner = PartnerModel(
          id: 'p-1',
          userId: 'u-1',
          businessName: 'Test Partner',
          approvalStatus: 'approved',
          availabilityStatus: 'available',
          createdAt: DateTime(2026),
          updatedAt: DateTime(2026),
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              driverDashboardProvider.overrideWith(
                (ref) => MockDriverDashboardNotifier(
                  DriverDashboardState(partner: partner, isLoading: false),
                ),
              ),
              driverRideProvider.overrideWith(
                (ref) => MockDriverRideNotifier(
                  DriverRideState(
                    currentRide: passengerRide,
                    availableRides: [],
                  ),
                ),
              ),
            ],
            child: const MaterialApp(home: DriverRideRequestScreen()),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text('Complete Ride'), findsOneWidget);
        expect(find.text('Delivery PIN'), findsNothing);
        expect(find.text('Verify Delivery PIN & Complete'), findsNothing);
      },
    );
  });
}
