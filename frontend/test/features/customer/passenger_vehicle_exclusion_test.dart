import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/domain/repositories/ride_repository.dart';
import 'package:infurnus/features/customer/domain/utils/passenger_vehicle_filter.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/logistics_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/passenger_rides_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/ride_booking_screen.dart';

class NoLocation extends LocationService {
  @override
  Future<Position?> getCurrentPosition() async => null;
}

class _FakeRideRepository implements RideRepository {
  @override
  Future<List<FleetVehicleModel>> getFleet({
    String? sector,
    String? category,
  }) async => [];

  @override
  Future<FareEstimateModel> estimateFare(Map<String, dynamic> data) async =>
      FareEstimateModel.fromJson({
        'grossAmount': 2000,
        'baseAmount': 1500,
        'distanceAmount': 500,
        'timeAmount': 0,
        'distanceMeters': 1000,
        'durationSeconds': 60,
        'currency': 'INR',
      });

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('Passenger Vehicle Exclusion Tests (Bike, Auto, E-Rickshaw)', () {
    test('isExcludedPassengerVehicle correctly identifies excluded vehicles', () {
      // Excluded variations
      expect(isExcludedPassengerVehicle('bike'), isTrue);
      expect(isExcludedPassengerVehicle('motorcycle'), isTrue);
      expect(isExcludedPassengerVehicle('two_wheeler'), isTrue);
      expect(isExcludedPassengerVehicle('auto'), isTrue);
      expect(isExcludedPassengerVehicle('auto_rickshaw'), isTrue);
      expect(isExcludedPassengerVehicle('e_rickshaw'), isTrue);
      expect(isExcludedPassengerVehicle('e-rickshaw'), isTrue);
      expect(isExcludedPassengerVehicle('personal_e_rickshaw'), isTrue);
      expect(isExcludedPassengerVehicle('personal e rickshaw'), isTrue);
      expect(isExcludedPassengerVehicle('tuk_tuk'), isTrue);

      // By name
      expect(isExcludedPassengerVehicle(null, 'Bike'), isTrue);
      expect(isExcludedPassengerVehicle(null, 'Auto'), isTrue);
      expect(isExcludedPassengerVehicle(null, 'E-Rickshaw'), isTrue);
      expect(isExcludedPassengerVehicle(null, 'Personal E Rickshaw'), isTrue);

      // Remaining valid passenger vehicles MUST NOT be excluded
      expect(isExcludedPassengerVehicle('hatchback'), isFalse);
      expect(isExcludedPassengerVehicle('sedan'), isFalse);
      expect(isExcludedPassengerVehicle('innova'), isFalse);
      expect(isExcludedPassengerVehicle('winger'), isFalse);
      expect(isExcludedPassengerVehicle('traveller'), isFalse);
      expect(isExcludedPassengerVehicle('cab_economy'), isFalse);
      expect(isExcludedPassengerVehicle('cab_premium'), isFalse);

      // Logistics & emergency vehicles MUST NOT be excluded
      expect(isExcludedPassengerVehicle('piaggio_ape', 'Piaggio Ape'), isFalse);
      expect(isExcludedPassengerVehicle('tata_magic', 'Tata Magic'), isFalse);
      expect(isExcludedPassengerVehicle('cargo_207', '207 Cargo'), isFalse);
      expect(isExcludedPassengerVehicle('cargo_407', '407 Cargo'), isFalse);
      expect(isExcludedPassengerVehicle('ambulance', 'Ambulance'), isFalse);
      expect(isExcludedPassengerVehicle('towing', 'Towing Van'), isFalse);
      expect(isExcludedPassengerVehicle('jcb', 'JCB Excavator'), isFalse);
    });

    testWidgets(
      'PassengerRidesScreen displays only supported passenger vehicles and excludes Bike, Auto, E-Rickshaw',
      (tester) async {
        tester.view.physicalSize = const Size(800, 1600);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        await tester.pumpWidget(
          const ProviderScope(
            child: MaterialApp(
              home: PassengerRidesScreen(),
            ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));

        // Must NOT contain Bike, Auto, or E-Rickshaw cards or text
        expect(find.text('Bike'), findsNothing);
        expect(find.text('Auto'), findsNothing);
        expect(find.text('E-Rickshaw'), findsNothing);
        expect(find.text('Personal E Rickshaw'), findsNothing);

        // Must contain valid passenger options
        expect(find.text('Hatchback'), findsWidgets);
        expect(find.text('Sedan'), findsWidgets);
        expect(find.text('Innova Crysta'), findsOneWidget);
        expect(find.text('Winger'), findsOneWidget);
        expect(find.text('Force Traveller'), findsOneWidget);
      },
    );


    testWidgets(
      'RideBookingScreen rejects previously selected Bike, Auto, or E-Rickshaw and blocks booking',
      (tester) async {
        tester.view.physicalSize = const Size(800, 1600);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        // Set up container with an unsupported previously selected vehicle ('bike')
        final container = ProviderContainer(
          overrides: [
            rideRepositoryProvider.overrideWithValue(_FakeRideRepository()),
            locationServiceProvider.overrideWithValue(NoLocation()),
          ],
        );
        addTearDown(container.dispose);

        container.read(rideProvider.notifier).setRoute(
          'Indiranagar, Bangalore',
          'Koramangala, Bangalore',
          pickupCoords: const LatLng(12.9716, 77.5946),
          destCoords: const LatLng(12.9352, 77.6245),
          vehicleCategory: 'bike',
          sector: 'passenger',
        );

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const MaterialApp(
              home: RideBookingScreen(),
            ),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));

        // Must warn that vehicle is not available
        expect(find.text('Vehicle Not Available'), findsOneWidget);
        expect(find.text('Select a Valid Passenger Vehicle'), findsOneWidget);

        // Tapping the select/change button opens vehicle selection bottom sheet
        await tester.tap(find.text('Select a Valid Passenger Vehicle'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        // In the bottom sheet, Bike, Auto, E-Rickshaw must NOT appear
        expect(find.text('Select Vehicle'), findsOneWidget);
        expect(find.widgetWithText(InkWell, 'Bike'), findsNothing);
        expect(find.widgetWithText(InkWell, 'Auto'), findsNothing);

        // Valid vehicles must appear
        expect(find.text('Hatchback'), findsOneWidget);
        expect(find.text('Sedan'), findsOneWidget);

        // Selecting Hatchback switches selection to valid vehicle
        await tester.tap(find.text('Hatchback'));
        await tester.pumpAndSettle();

        expect(container.read(rideProvider).selectedTier, 'hatchback');
      },
    );

    testWidgets('Other sectors (Logistics, Emergency, Rentals) are unaffected', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(800, 1600);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      // Logistics retains cargo vehicles (Piaggio Ape, Tata Magic, etc.)
      await tester.pumpWidget(
        const ProviderScope(
          child: MaterialApp(
            home: LogisticsScreen(),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Piaggio Ape'), findsOneWidget);
      expect(find.text('Tata Magic'), findsOneWidget);
    });
  });
}
