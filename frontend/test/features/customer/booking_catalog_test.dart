import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/features/customer/data/datasources/ride_remote_data_source.dart';
import 'package:infurnus/features/customer/data/models/fare_estimate_model.dart';
import 'package:infurnus/features/customer/data/models/fleet_vehicle_model.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';
import 'package:infurnus/features/customer/presentation/widgets/configured_vehicle_screen.dart';

import 'vehicle_fare_ranges_test.dart'
    show RecordingRepository, ConnectedSocket, range;
import 'location_independent_booking_test.dart' show mapFixture;

class CatalogRepository extends RecordingRepository {
  final String sector, code, name;
  CatalogRepository(this.sector, this.code, this.name);
  @override
  Future<List<FleetVehicleModel>> getFleet({
    String? sector,
    String? category,
  }) async => [
    FleetVehicleModel(
      id: 'configured-id',
      make: '',
      model: name,
      name: name,
      sector: this.sector,
      category: code,
      fuelRatePerKm: 0,
      loadCapacityKg: 0,
    ),
  ];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  for (final entry in [
    ('passenger', 'innova_crysta', 'Configured Innova'),
    ('logistics', 'tata_407', 'Tata 407'),
    ('premium', 'thar', 'Mahindra Thar'),
    ('service', 'configured_crane', 'Configured Crane'),
  ]) {
    test(
      'catalog ${entry.$1} retains its configured code, not a display-name alias',
      () async {
        final requests = <RequestOptions>[];
        final dio = Dio()
          ..interceptors.add(
            InterceptorsWrapper(
              onRequest: (request, handler) {
                requests.add(request);
                handler.resolve(
                  Response(
                    requestOptions: request,
                    statusCode: 200,
                    data: {
                      'data': [
                        {
                          'id': 'configured-id',
                          'name': entry.$3,
                          'code': entry.$2,
                          'sector': entry.$1,
                          'serviceFixedFare': 100,
                          'serviceRadiusMeters': 25000,
                        },
                      ],
                    },
                  ),
                );
              },
            ),
          );
        final types = await RideRemoteDataSourceImpl(dio)
            .getFleet(sector: entry.$1);
        expect(requests.single.path, '/vehicles/catalog');
        expect(requests.single.queryParameters, {
          'sector': entry.$1,
          'limit': 100,
        });
        expect(types.single.category, entry.$2);
        expect(types.single.displayName, entry.$3);
      },
    );
    testWidgets(
      '${entry.$1} selection carries the exact configured code into booking',
      (tester) async {
        final repository = CatalogRepository(entry.$1, entry.$2, entry.$3)
          ..estimate = FareEstimateModel.fromJson(range(quote: true));
        final socket = ConnectedSocket();
        final container = ProviderContainer(
          overrides: [
            rideRepositoryProvider.overrideWithValue(repository),
            socketServiceProvider.overrideWithValue(socket),
            dioProvider.overrideWithValue(mapFixture()),
          ],
        );
        final router = GoRouter(
          routes: [
            GoRoute(
              path: '/',
              builder: (_, _) =>
                  ConfiguredVehicleScreen(title: 'Vehicles', sector: entry.$1),
            ),
            GoRoute(
              path: '/ride-booking',
              builder: (_, _) => const Scaffold(body: Text('Booking')),
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
        expect(find.text(entry.$3), findsOneWidget);
        await tester.tap(find.text(entry.$3));
        await tester.pumpAndSettle();
        final notifier = container.read(rideProvider.notifier);
        expect(container.read(rideProvider).selectedTier, entry.$2);
        notifier.setRoute(
          'Pickup',
          'Destination',
          pickupCoords: const LatLng(25.6, 85.1),
          destCoords: const LatLng(26.1, 85.3),
        );
        await notifier.estimateRouteFare();
        if (entry.$1 != 'service') {
          await notifier.requestRide();
          expect(repository.bookingPayload?['vehicleCategory'], entry.$2);
        }
        expect(repository.payloads.last['vehicleCategory'], entry.$2);
        await tester.pump(const Duration(milliseconds: 50));
        await tester.pumpWidget(const SizedBox.shrink());
        container.dispose();
        socket.dispose();
        router.dispose();
        await tester.pump(const Duration(milliseconds: 50));
      },
    );
  }
  test('Tata 407 and 407 Cargo remain separate priced categories', () async {
    final dio = Dio()
      ..interceptors.add(
        InterceptorsWrapper(
          onRequest: (request, handler) => handler.resolve(
            Response(
              requestOptions: request,
              statusCode: 200,
              data: {
                'data': [
                  {
                    'id': 'tata',
                    'name': 'Tata 407',
                    'code': 'tata_407',
                    'sector': 'logistics',
                  },
                  {
                    'id': 'cargo',
                    'name': '407 Cargo',
                    'code': 'cargo_407',
                    'sector': 'logistics',
                  },
                ],
              },
            ),
          ),
        ),
      );
    expect(
      (await RideRemoteDataSourceImpl(dio).getFleet(sector: 'logistics'))
          .map((v) => v.category),
      ['tata_407', 'cargo_407'],
    );
  });
}
