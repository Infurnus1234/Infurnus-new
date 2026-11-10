import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/presentation/providers/booking_catalog_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/screens/passenger_rides_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/logistics_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/concierge_fleet_screen.dart';
import 'package:infurnus/features/customer/presentation/screens/specialty_emergency_screen.dart';

import 'configured_catalog_fixture.dart';
import 'vehicle_fare_ranges_test.dart' show ConnectedSocket;
import 'location_independent_booking_test.dart' show mapFixture;

class MutableCatalog extends ConfiguredCatalogRepository {
  List<FleetVehicleModel> rows = [];
  @override
  Future<List<FleetVehicleModel>> getFleet({
    String? sector,
    String? category,
  }) async => rows.where((vehicle) => vehicle.sector == sector).toList();
}

FleetVehicleModel option(
  String sector,
  String code,
  String name, {
  bool active = true,
  bool visible = true,
}) => FleetVehicleModel(
  id: code,
  name: name,
  make: '',
  model: '',
  sector: sector,
  category: code,
  fuelRatePerKm: 0,
  loadCapacityKg: 0,
  active: active,
  catalogVisible: visible,
);

void main() {
  for (final sector in ['rental', 'logistics', 'premium', 'service']) {
    testWidgets(
      '$sector reflects Admin catalog refreshes and preserves the selected exact code',
      (tester) async {
        final repository = MutableCatalog()
          ..rows = [
            option(sector, 'existing', 'Existing option'),
            option(sector, 'inactive', 'Unpriced option', active: false),
            option(sector, 'hidden', 'Hidden option', visible: false),
          ];
        final socket = ConnectedSocket();
        final container = ProviderContainer(
          overrides: [
            rideRepositoryProvider.overrideWithValue(repository),
            socketServiceProvider.overrideWithValue(socket),
            dioProvider.overrideWithValue(mapFixture()),
          ],
        );
        final page = switch (sector) {
          'rental' => const PassengerRidesScreen(),
          'logistics' => const LogisticsScreen(),
          'premium' => const ConciergeFleetScreen(),
          _ => const SpecialtyEmergencyScreen(),
        };
        final router = GoRouter(
          routes: [
            GoRoute(path: '/', builder: (_, _) => page),
            GoRoute(
              path: '/ride-booking',
              builder: (_, _) =>
                  const Scaffold(body: Text('Booking destination')),
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
        expect(find.text('Existing option'), findsOneWidget);
        expect(find.text('Unpriced option'), findsOneWidget);
        expect(find.text('Hidden option'), findsNothing);
        repository.rows.add(
          option(sector, 'admin_added', 'Admin added option', active: false),
        );
        container.invalidate(bookingCatalogProvider(sector));
        await tester.pumpAndSettle();
        expect(find.text('Admin added option'), findsOneWidget);
        repository.rows = [
          option(
            sector,
            'admin_added',
            'Renamed Admin option',
            active: false,
            visible: false,
          ),
        ];
        container.invalidate(bookingCatalogProvider(sector));
        await tester.pumpAndSettle();
        expect(find.text('Admin added option'), findsNothing);
        expect(find.text('Existing option'), findsNothing);
        repository.rows = [
          option(sector, 'admin_added', 'Renamed Admin option', active: false),
        ];
        container.invalidate(bookingCatalogProvider(sector));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Renamed Admin option'));
        await tester.pumpAndSettle();
        expect(container.read(rideProvider).selectedTier, 'admin_added');
        expect(container.read(rideProvider).selectedSector, sector);
        expect(find.text('Booking destination'), findsOneWidget);
        await tester.pumpWidget(const SizedBox());
        router.dispose();
        container.dispose();
        socket.dispose();
      },
    );
  }
}
