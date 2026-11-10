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
  test('unsupported catalog responses surface an error instead of inventing bundled options', () async {
    final dio = Dio()
      ..interceptors.add(
        InterceptorsWrapper(
          onRequest: (request, handler) {
            handler.reject(
              DioException(
                requestOptions: request,
                response: Response(requestOptions: request, statusCode: 400),
                type: DioExceptionType.badResponse,
              ),
            );
          },
        ),
      );
    final source = RideRemoteDataSourceImpl(dio);
    await expectLater(
      source.getFleet(sector: 'rental'),
      throwsA(isA<DioException>()),
    );
    await expectLater(
      source.getFleet(sector: 'premium'),
      throwsA(isA<DioException>()),
    );
  });
  test(
    'catalog pagination retains Admin additions beyond the first 100 rows',
    () async {
      final offsets = <int>[];
      final dio = Dio()
        ..interceptors.add(
          InterceptorsWrapper(
            onRequest: (request, handler) {
              final offset = request.queryParameters['offset'] as int? ?? 0;
              offsets.add(offset);
              handler.resolve(
                Response(
                  requestOptions: request,
                  statusCode: 200,
                  data: {
                    'data': List.generate(
                      offset == 0 ? 100 : 1,
                      (index) => {
                        'id': 'configured-${offset + index}',
                        'name': 'Admin vehicle ${offset + index}',
                        'code': 'admin_${offset + index}',
                        'sector': 'logistics',
                        'active': true,
                        'catalogVisible': true,
                      },
                    ),
                  },
                ),
              );
            },
          ),
        );
      final types = await RideRemoteDataSourceImpl(dio)
          .getFleet(sector: 'logistics');
      expect(offsets, [0, 100]);
      expect(types, hasLength(101));
      expect(types.last.category, 'admin_100');
      expect(types.last.displayName, 'Admin vehicle 100');
    },
  );
  for (final entry in [
    ('passenger', 'innova', 'Innova Crysta'),
    ('passenger', 'mini', 'Minicab'),
    ('rental', 'mini', 'Minicab'),
    ('logistics', 'tata_407', 'Tata 407'),
    ('premium', 'thar', 'Mahindra Thar'),
    ('service', 'ambulance', 'Ambulance'),
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
        await tester.scrollUntilVisible(
          find.text(entry.$3),
          180,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.ensureVisible(find.text(entry.$3));
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
        if (entry.$1 == 'rental') notifier.setRentalDetails({'hours': 17});
        await notifier.estimateRouteFare();
        if (entry.$1 != 'service') {
          await notifier.requestRide();
          expect(repository.bookingPayload?['vehicleCategory'], entry.$2);
        }
        expect(repository.payloads.last['vehicleCategory'], entry.$2);
        if (entry.$1 == 'rental') {
          expect(repository.payloads.last['sector'], 'rental');
          expect(repository.payloads.last['bookingHours'], 17);
          expect(repository.bookingPayload?['sector'], 'rental');
          expect(repository.bookingPayload?['bookingHours'], 17);
        }
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
