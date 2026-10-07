import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:infurnus/core/network/dio_client.dart';
import 'package:infurnus/core/services/map_service.dart';
import 'package:infurnus/core/services/socket_service.dart';
import 'package:infurnus/core/utils/polyline_decoder.dart';
import 'package:infurnus/features/customer/data/models/ride_model.dart'
    as model;
import 'package:infurnus/features/customer/domain/repositories/ride_repository.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_provider.dart';
import 'package:infurnus/features/customer/presentation/providers/ride_repository_provider.dart';

class _Socket extends SocketService {
  final events = StreamController<SocketServerEvent>.broadcast();
  @override
  Stream<SocketServerEvent> get eventStream => events.stream;
  @override
  SocketConnectionState get currentState => SocketConnectionState.connected;
  @override
  void joinRide(String id) {}
  @override
  void leaveRide(String id) {}
  @override
  void dispose() {
    events.close();
    super.dispose();
  }
}

class _Repository implements RideRepository {
  final model.RideModel ride;
  _Repository(this.ride);
  @override
  Future<model.RideModel> getRide(String id) async => ride;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final fixtures = <List<LatLng>>[
    [const LatLng(25.5941, 85.1376), const LatLng(25.6225, 85.0412)],
    [const LatLng(24.7955, 85.0002), const LatLng(24.6951, 84.9913)],
    [const LatLng(26.1225, 85.3906), const LatLng(26.1542, 85.8918)],
    [const LatLng(25.2425, 86.9842), const LatLng(25.7771, 87.4753)],
  ];
  for (var index = 0; index < fixtures.length; index++) {
    test(
      'Bihar route fixture $index uses selected coordinates without vehicle availability',
      () async {
        final calls = <RequestOptions>[];
        final dio = Dio();
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (o, h) {
              calls.add(o);
              h.resolve(
                Response(
                  requestOptions: o,
                  data: {
                    'data': {
                      'distanceMeters': 1000,
                      'durationSeconds': 120,
                      'encodedPolyline': '???o}@',
                    },
                  },
                ),
              );
            },
          ),
        );
        final container = ProviderContainer(
          overrides: [dioProvider.overrideWithValue(dio)],
        );
        addTearDown(container.dispose);
        final notifier = container.read(rideProvider.notifier);
        notifier.setRoute(
          'Fixture pickup',
          'Fixture drop',
          pickupCoords: fixtures[index][0],
          destCoords: fixtures[index][1],
        );
        await notifier.refreshRideMap();
        expect(calls.last.path, '/maps/route');
        expect(calls.last.data['origin'], {
          'latitude': fixtures[index][0].latitude,
          'longitude': fixtures[index][0].longitude,
        });
        expect(calls.last.data['destination'], {
          'latitude': fixtures[index][1].latitude,
          'longitude': fixtures[index][1].longitude,
        });
        expect(container.read(rideProvider).currentRoute, isNotNull);
      },
    );
  }
  test(
    'failed routing retains selected coordinates and reports a map error',
    () async {
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (o, h) => h.reject(DioException(requestOptions: o)),
        ),
      );
      final c = ProviderContainer(
        overrides: [dioProvider.overrideWithValue(dio)],
      );
      addTearDown(c.dispose);
      final n = c.read(rideProvider.notifier);
      n.setRoute(
        'A',
        'B',
        pickupCoords: fixtures.first[0],
        destCoords: fixtures.first[1],
      );
      await n.refreshRideMap();
      expect(c.read(rideProvider).pickupCoords, fixtures.first[0]);
      expect(c.read(rideProvider).mapError, isNotEmpty);
    },
  );
  test(
    'late route result cannot overwrite changed coordinates or a reset ride',
    () async {
      final handlers = <RequestInterceptorHandler>[];
      final requests = <RequestOptions>[];
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (o, h) {
            requests.add(o);
            handlers.add(h);
          },
        ),
      );
      final c = ProviderContainer(
        overrides: [dioProvider.overrideWithValue(dio)],
      );
      addTearDown(c.dispose);
      final n = c.read(rideProvider.notifier);
      n.setRoute(
        'A',
        'B',
        pickupCoords: fixtures.first[0],
        destCoords: fixtures.first[1],
      );
      await Future<void>.delayed(Duration.zero);
      n.resetRide();
      for (var i = 0; i < handlers.length; i++) {
        handlers[i].resolve(
          Response(
            requestOptions: requests[i],
            data: {
              'data': {'distanceMeters': 1000, 'durationSeconds': 120},
            },
          ),
        );
      }
      await Future<void>.delayed(Duration.zero);
      expect(c.read(rideProvider).currentRoute, isNull);
      expect(c.read(rideProvider).currentRide, isNull);
    },
  );
  test('live driver updates reject invalid/older/unrelated data; completion clears route', () async {
    final socket = _Socket();
    final ride = model.RideModel(
      id: 'ride-fixture',
      customerId: 'customer',
      assignedDriverId: 'driver',
      pickup: model.RideLocation(latitude: 25, longitude: 85),
      destination: model.RideLocation(latitude: 26, longitude: 86),
      status: model.RideStatus.driverAssigned,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
    );
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (o, h) {
          expect(o.queryParameters['includeRoute'], true);
          h.resolve(
            Response(
              requestOptions: o,
              data: {
                'data': {
                  'route': {'distanceMeters': 1000, 'durationSeconds': 120},
                  'driverLocation': null,
                },
              },
            ),
          );
        },
      ),
    );
    final c = ProviderContainer(
      overrides: [
        dioProvider.overrideWithValue(dio),
        socketServiceProvider.overrideWithValue(socket),
        rideRepositoryProvider.overrideWithValue(_Repository(ride)),
      ],
    );
    addTearDown(() {
      c.dispose();
      socket.dispose();
    });
    await c.read(rideProvider.notifier).getRideDetails(ride.id);
    await Future<void>.delayed(Duration.zero);
    for (var i = 0; i < 3; i++) {
      socket.events.add(
        SocketServerEvent(
          name: 'ride:driver_location_updated',
          data: {
            'rideId': ride.id,
            'location': {
              'latitude': 25 + i / 100,
              'longitude': 85,
              'timestamp': DateTime.utc(2026, 10, 7, 0, 0, i).toIso8601String(),
            },
          },
        ),
      );
    }
    await Future<void>.delayed(Duration.zero);
    expect(c.read(rideProvider).lastDriverLocation!.latitude, 25.02);
    for (final location in [
      {
        'latitude': 91,
        'longitude': 85,
        'timestamp': DateTime.utc(2026, 10, 7).toIso8601String(),
      },
      {
        'latitude': 25,
        'longitude': 85,
        'timestamp': DateTime.utc(2026, 10, 7).toIso8601String(),
      },
    ]) {
      socket.events.add(
        SocketServerEvent(
          name: 'ride:driver_location_updated',
          data: {'rideId': ride.id, 'location': location},
        ),
      );
    }
    socket.events.add(
      SocketServerEvent(
        name: 'ride:driver_location_updated',
        data: {
          'rideId': 'unrelated',
          'location': {'latitude': 25, 'longitude': 85},
        },
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(c.read(rideProvider).lastDriverLocation!.latitude, 25.02);
    socket.events.add(
      SocketServerEvent(name: 'ride:cancelled', data: {'rideId': ride.id}),
    );
    await Future<void>.delayed(Duration.zero);
    expect(c.read(rideProvider).currentRoute, isNull);
    expect(c.read(rideProvider).lastDriverLocation, isNull);
  });
  test('map controller services are isolated per widget owner', () {
    final c = ProviderContainer();
    addTearDown(c.dispose);
    expect(
      identical(
        c.read(mapServiceProvider(Object())),
        c.read(mapServiceProvider(Object())),
      ),
      false,
    );
  });
  test('malformed/truncated polylines cannot crash map rendering', () {
    for (final encoded in ['?', '~~~~~~~', '\u0000', '_p~iF']) {
      expect(PolylineDecoder.decode(encoded), isEmpty);
    }
    expect(PolylineDecoder.decode('_p~iF~ps|U_ulLnnqC_mqNvxq`@').length, 3);
  });
}
