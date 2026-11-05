import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:infurnus/features/customer/presentation/screens/specialty_emergency_screen.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart'
    as model;
import 'package:infurnus/features/customer/presentation/providers/booking_catalog_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/customer_home_screen.dart';
import 'package:infurnus/features/customer/presentation/widgets/ride_contact_action.dart';
import 'package:infurnus/shared/widgets/vehicle_visual_image.dart';

import 'vehicle_fare_ranges_test.dart'
    show RecordingRepository, ConnectedSocket;
import 'location_independent_booking_test.dart' show mapFixture;

model.RideModel ride({
  String? phone = '+919876543210',
  model.RideStatus status = model.RideStatus.driverAssigned,
  String sector = 'service',
  bool assigned = true,
}) => model.RideModel(
  id: 'ride',
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
  test('only an active assigned ride can supply its contact number', () {
    expect(assignedRideContactUri(ride())?.toString(), 'tel:+919876543210');
    for (final status in [
      model.RideStatus.completed,
      model.RideStatus.cancelled,
      model.RideStatus.searching,
    ]) {
      expect(assignedRideContactUri(ride(status: status)), isNull);
    }
    expect(assignedRideContactUri(ride(assigned: false)), isNull);
    expect(
      assignedRideContactUri(ride(sector: 'premium'), serviceOnly: true),
      isNull,
    );
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
  test('Three-Wheeler and Mini Cab use the verified existing assets', () {
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
      'assets/images/cargo_407.jpg',
    );
  });
  testWidgets(
    'Service and Premium preserve horizontal rows and Service See all opens the complete listing',
    (tester) async {
      final socket = ConnectedSocket();
      final container = ProviderContainer(
        overrides: [
          rideRepositoryProvider.overrideWithValue(RecordingRepository()),
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
        ('service', 'JCB', 3),
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
      for (final name in ['Ambulance', 'Towing Van', 'JCB']) {
        expect(find.text(name), findsOneWidget);
      }
      await tester.pumpWidget(const SizedBox.shrink());
      container.dispose();
      socket.dispose();
      router.dispose();
    },
  );
}
