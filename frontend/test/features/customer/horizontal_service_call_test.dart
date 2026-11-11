import 'configured_catalog_fixture.dart';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:infurnus/core/services/location_service.dart';
import 'package:infurnus/features/customer/presentation/screens/specialty_emergency_screen.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart'
    as model;
import 'package:infurnus/features/customer/presentation/providers/booking_catalog_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/customer_home_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/concierge_fleet_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/passenger_rides_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/rentals_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/ride_booking_screen.dart';
import 'package:infurnus/features/customer/presentation/widgets/ride_contact_action.dart';
import 'package:infurnus/shared/widgets/vehicle_visual_image.dart';

import 'vehicle_fare_ranges_test.dart' show ConnectedSocket;
import 'location_independent_booking_test.dart' show mapFixture;
import 'passenger_vehicle_exclusion_test.dart' show NoLocation;

model.RideModel ride({
  String? phone = '+919153787859',
  model.RideStatus status = model.RideStatus.driverAssigned,
  String sector = 'service',
  bool assigned = true,
}) => model.RideModel(
  id: 'ride',
  bookingId: '2200382',
  callingNumber: phone,
  customerId: 'customer',
  assignedDriverId: assigned ? 'driver' : null,
  pickup: model.RideLocation(latitude: 25.6, longitude: 85.1),
  destination: model.RideLocation(latitude: 26.1, longitude: 85.3),
  sector: sector,
  status: status,
  driverDetails: model.DriverDetails(
    id: 'driver',
    name: 'Assigned provider',
    phone: phone,
  ),
  createdAt: DateTime(2026),
  updatedAt: DateTime(2026),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  testWidgets(
    'Home Premium links open the same fleet and Rental opens Rental',
    (tester) async {
      final socket = ConnectedSocket();
      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(
            ConfiguredCatalogRepository(),
          ),
          socketServiceProvider.overrideWithValue(socket),
          locationServiceProvider.overrideWithValue(NoLocation()),
          dioProvider.overrideWithValue(mapFixture()),
        ],
      );
      final router = GoRouter(
        routes: [
          GoRoute(path: '/', builder: (_, _) => const CustomerHomeScreen()),
          GoRoute(
            path: '/concierge-fleet',
            builder: (_, _) => const ConciergeFleetScreen(),
          ),
          GoRoute(
            path: '/premium-showcase',
            builder: (_, _) => const RentalsScreen(),
          ),
          GoRoute(
            path: '/rentals',
            builder: (_, _) => const PassengerRidesScreen(),
          ),
        ],
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();

      final premium = find.text('Luxury & Chauffeur');
      await tester.ensureVisible(premium);
      await tester.pumpAndSettle();
      await tester.tap(premium);
      await tester.pumpAndSettle();
      expect(find.byType(ConciergeFleetScreen), findsOneWidget);
      expect(find.text('Mahindra Thar'), findsOneWidget);
      router.pop();
      await tester.pumpAndSettle();

      final premiumHeader = find
          .ancestor(
            of: find.text('Experience the extraordinary'),
            matching: find.byType(Row),
          )
          .first;
      final seeAll = find.descendant(
        of: premiumHeader,
        matching: find.text('See all →'),
      );
      await tester.ensureVisible(seeAll);
      await tester.pumpAndSettle();
      await tester.tap(seeAll);
      await tester.pumpAndSettle();
      expect(find.byType(ConciergeFleetScreen), findsOneWidget);
      expect(find.text('Mahindra Thar'), findsOneWidget);
      router.pop();
      await tester.pumpAndSettle();

      final rental = find.text('Cab, Sedan & More');
      await tester.ensureVisible(rental);
      await tester.pumpAndSettle();
      await tester.tap(rental);
      await tester.pumpAndSettle();
      expect(find.byType(PassengerRidesScreen), findsOneWidget);
      expect(container.read(rideProvider).selectedSector, 'rental');
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      socket.dispose();
      router.dispose();
    },
  );
  testWidgets(
    'Service booking uses the normal destination step before a fare',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final socket = ConnectedSocket();
      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(
            ConfiguredCatalogRepository(),
          ),
          socketServiceProvider.overrideWithValue(socket),
          locationServiceProvider.overrideWithValue(NoLocation()),
          dioProvider.overrideWithValue(mapFixture()),
        ],
      );
      final notifier = container.read(rideProvider.notifier);
      notifier.selectSector('service');
      notifier.selectTier('ambulance');
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: RideBookingScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Call'), findsNothing);
      final label = find.text('Select Destination to View Fares');
      expect(label, findsOneWidget);
      final button = find.ancestor(
        of: label,
        matching: find.byType(ElevatedButton),
      );
      expect(tester.widget<ElevatedButton>(button).onPressed, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      socket.dispose();
    },
  );
  test('only an active assigned ride can supply its contact number', () {
    expect(assignedRideContactUri(ride())?.toString(), 'tel:+919153787859');
    for (final status in [
      model.RideStatus.completed,
      model.RideStatus.cancelled,
      model.RideStatus.searching,
    ]) {
      expect(assignedRideContactUri(ride(status: status)), isNull);
    }
    expect(assignedRideContactUri(ride(assigned: false)), isNull);
  });
  test('phone validation rejects missing and injected contact data', () {
    for (final phone in [
      null,
      '',
      'not-a-phone',
      '112',
      'tel:+919876543210',
      '+919876543210;extra',
      '+919876543210?call=1',
    ]) {
      expect(assignedRideContactUri(ride(phone: phone)), isNull, reason: phone);
    }
    expect(
      assignedRideContactUri(ride(phone: '+91 (98765) 43210'))?.path,
      '+919876543210',
    );
  });
  test('valid assigned contact invokes the real tel action; invalid never launches', () async {
    Uri? launched;
    expect(
      await launchAssignedRideContact(
        ride(),
        launcher: (uri) async {
          launched = uri;
          return true;
        },
      ),
      isTrue,
    );
    expect(launched?.scheme, 'tel');
    expect(launched?.hasQuery, isFalse);
    launched = null;
    expect(
      await launchAssignedRideContact(
        ride(phone: 'bad'),
        launcher: (uri) async {
          launched = uri;
          return true;
        },
      ),
      isFalse,
    );
    expect(launched, isNull);
  });
  test('Mini Cab and Three-Wheeler retain their images while 407 uses the supplied asset', () {
    expect(
      VehicleVisualImage.getAssetPath('3-Wheeler (Goods)', 'three_wheeler'),
      'assets/images/e_rickshaw_green_white.png',
    );
    expect(
      VehicleVisualImage.getAssetPath('Mini Cab', 'hatchback'),
      'assets/images/hatchback_clean.jpg',
    );
    expect(
      VehicleVisualImage.getAssetPath('407 Cargo', 'cargo_407'),
      'assets/images/logistics_tata_407.webp',
    );
  });
  testWidgets(
    'Service and Premium preserve horizontal rows and Service See all opens the complete listing',
    (tester) async {
      final socket = ConnectedSocket();
      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(
            ConfiguredCatalogRepository(),
          ),
          socketServiceProvider.overrideWithValue(socket),
          dioProvider.overrideWithValue(mapFixture()),
          bookingCatalogProvider('passenger').overrideWith((ref) async => []),
          bookingCatalogProvider('logistics').overrideWith((ref) async => []),
        ],
      );
      final router = GoRouter(
        routes: [
          GoRoute(path: '/', builder: (_, _) => const CustomerHomeScreen()),
          GoRoute(
            path: '/specialty-emergency',
            builder: (_, _) => const SpecialtyEmergencyScreen(),
          ),
        ],
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      final outer = find
          .descendant(
            of: find.byType(SingleChildScrollView).first,
            matching: find.byType(Scrollable),
          )
          .first;
      for (final entry in [
        ('service', 'Towing Van', 4),
        ('premium', 'Helicopter', 6),
      ]) {
        final row = find.byKey(ValueKey('vehicle-row:${entry.$1}'));
        await tester.scrollUntilVisible(row, 250, scrollable: outer);
        await tester.ensureVisible(row);
        await tester.pumpAndSettle();
        final list = tester.widget<ListView>(row);
        expect(list.scrollDirection, Axis.horizontal);
        expect(
          (list.childrenDelegate as SliverChildBuilderDelegate).childCount,
          entry.$3 * 2 - 1,
        );
        await tester.drag(row, const Offset(-1000, 0));
        await tester.pumpAndSettle();
        expect(
          find.descendant(of: row, matching: find.text(entry.$2)),
          findsOneWidget,
        );
      }
      final title = find.text('Service Vehicles');
      await tester.ensureVisible(title);
      await tester.pumpAndSettle();
      final header = find.ancestor(of: title, matching: find.byType(Row)).first;
      final seeAll = find.descendant(
        of: header,
        matching: find.text('See all →'),
      );
      expect(seeAll, findsOneWidget);
      expect(
        find.descendant(of: header, matching: find.text('Call')),
        findsNothing,
      );
      final style = tester.widget<Text>(seeAll).style!;
      expect(style.color, const Color(0xFF16A34A));
      expect(style.fontSize, 13);
      expect(style.fontWeight, FontWeight.bold);
      await tester.tap(seeAll);
      await tester.pumpAndSettle();
      expect(find.text('Specialty & Emergency'), findsOneWidget);
      for (final name in ['Ambulance', 'Crane', 'JCB', 'Towing Van']) {
        expect(find.text(name), findsOneWidget);
      }
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      socket.dispose();
      router.dispose();
    },
  );
}
